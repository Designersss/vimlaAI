import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "@vimla/auth";
import { AiError, encodeVimlaSse } from "@vimla/ai";
import { isBillingError } from "@vimla/billing";
import {
  conversationCreatedSchema,
  conversationDetailSchema,
  conversationsResponseSchema,
  createConversationSchema,
  sendMessageSchema,
  updateConversationDefaultTargetSchema,
  type ConversationCreated,
  type ConversationDetail,
  type ConversationsResponse,
} from "@vimla/contracts";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { SensitiveArea, SensitiveMutation } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { sseResponseHeaders } from "./sse-headers.js";
import { AiRateLimitGuard } from "./ai-rate-limit.guard.js";
import { ChatMentionRoutingService } from "./chat-mention-routing.service.js";
import { TextChatService } from "./text-chat.service.js";
import { buildOperatorRunView } from "../operator/view.js";
import { OrchestrationService } from "../orchestration/orchestration.service.js";

@Controller("v1/conversations")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard)
export class ConversationsController {
  constructor(
    @Inject(TextChatService) private readonly chat: TextChatService,
    @Inject(ChatMentionRoutingService) private readonly routing: ChatMentionRoutingService,
    @Inject(OrchestrationService) private readonly orchestration: OrchestrationService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ConversationCreated> {
    const parsed = createConversationSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid conversation payload");
    }

    const conversation = await this.chat.createConversation(
      user.id,
      parsed.data.title,
      parsed.data.projectId,
      parsed.data.defaultTarget,
    );
    return conversationCreatedSchema.parse({
      id: conversation.id,
      projectId: conversation.projectId,
      title: conversation.title,
      defaultTarget: toDefaultTarget(conversation),
      updatedAt: conversation.updatedAt.toISOString(),
    });
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser): Promise<ConversationsResponse> {
    const conversations = await this.chat.listConversations(user.id);
    return conversationsResponseSchema.parse({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        projectId: conversation.projectId,
        title: conversation.title,
        defaultTarget: toDefaultTarget(conversation),
        updatedAt: conversation.updatedAt.toISOString(),
      })),
    });
  }

  @Get(":id")
  async getOne(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<ConversationDetail> {
    const conversation = await this.chat.getConversation(user.id, id);
    const mentions = await this.routing.readForMessages(conversation.messages.map((message) => message.id));
    return conversationDetailSchema.parse({
      id: conversation.id,
      projectId: conversation.projectId,
      title: conversation.title,
      defaultTarget: toDefaultTarget(conversation),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
        operatorRun: message.operatorRun ? buildOperatorRunView(message.operatorRun, null) : null,
        mentions: mentions.get(message.id) ?? [],
      })),
    });
  }

  @Post(":id/default-target")
  @SensitiveMutation()
  @UseGuards(AiRateLimitGuard)
  @HttpCode(200)
  async setDefaultTarget(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
  ): Promise<ConversationDetail["defaultTarget"]> {
    const parsed =
      updateConversationDefaultTargetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid conversation target payload");
    }
    const conversation =
      await this.chat.setConversationDefaultTarget(
        user.id,
        conversationId,
        parsed.data,
      );
    return toDefaultTarget(conversation);
  }

  @Post(":id/messages")
  @SensitiveMutation()
  @UseGuards(AiRateLimitGuard)
  async sendMessage(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid message payload");
    }

    this.chat.assertMessageSize(parsed.data.content);
    await this.chat.getConversation(user.id, conversationId);

    const resolvedMentions = await this.routing.resolve({
      userId: user.id,
      content: parsed.data.content,
      mentions: parsed.data.mentions,
    });
    const route = this.routing.routeFor(resolvedMentions);

    reply.hijack();
    // hijack() skips Nest CORS; the browser reads this cross-origin SSE body.
    reply.raw.writeHead(200, sseResponseHeaders(this.config.webOrigin));
    reply.raw.write(":\n\n");

    const response = reply.raw;
    const sink = {
      isClientOpen: () => !response.writableEnded,
      write: (chunk: string) => {
        if (!response.writableEnded) response.write(chunk);
      },
    };

    try {
      if (route === "CHAT") {
        await this.chat.assertTextEnabled();
        await this.chat.streamMessage({
          userId: user.id,
          conversationId,
          body: parsed.data,
          correlationId: String(request.id),
          sink,
        });
        await this.routing.attachToAiRequest({
          userId: user.id,
          clientRequestId: parsed.data.clientRequestId,
          resolvedMentions,
        });
        return;
      }

      const result = await this.routing.persist({
        userId: user.id,
        conversationId,
        clientRequestId: parsed.data.clientRequestId,
        content: parsed.data.content,
        mentions: parsed.data.mentions,
        resolvedMentions,
      });
      if (!response.writableEnded) {
        response.write(
          encodeVimlaSse("route", {
            route: result.route,
            messageId: result.messageId,
            mentionCount: result.mentions.length,
          }),
        );
      }

      const workflow = await this.orchestration.planMessage(
        user.id,
        result.messageId,
        result.mentions,
        String(request.id),
        (planId) => {
          if (!response.writableEnded) {
            response.write(
              encodeVimlaSse("workflow", {
                status: "PLANNING",
                planId,
              }),
            );
          }
        },
      );

      if (!response.writableEnded) {
        response.write(
          encodeVimlaSse(
            "workflow",
            workflow.kind === "PLANNED" ||
            workflow.kind === "EXISTING_PLAN"
              ? {
                  status: workflow.kind,
                  planId: workflow.plan.id,
                }
              : workflow.kind === "PLANNING"
                ? {
                    status: workflow.kind,
                    planId: workflow.planId,
                  }
                : {
                    status: workflow.kind,
                    clarificationQuestion: workflow.clarificationQuestion,
                  },
          ),
        );
        response.write(
          encodeVimlaSse("done", {
            messageId: result.messageId,
            route: result.route,
            workflowStatus: workflow.kind,
            ...(workflow.kind === "PLANNED" ||
            workflow.kind === "EXISTING_PLAN"
              ? { planId: workflow.plan.id }
              : workflow.kind === "PLANNING"
                ? { planId: workflow.planId }
                : {}),
          }),
        );
      }
    } catch (error: unknown) {
      const payload = publicStreamError(error, String(request.id));
      if (!response.writableEnded) {
        response.write(encodeVimlaSse("error", payload));
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}

function publicStreamError(error: unknown, requestId: string): Record<string, string> {
  if (error instanceof AiError) {
    return { code: toApiCode(error.code), requestId };
  }

  if (isBillingError(error)) {
    return { code: error.code.toLowerCase(), requestId };
  }

  if (error instanceof HttpException) {
    const payload = error.getResponse();
    if (payload !== null && typeof payload === "object" && "code" in payload) {
      const code = payload.code;
      if (typeof code === "string") {
        return { code, requestId };
      }
    }
  }

  return { code: "internal_error", requestId };
}

function toApiCode(code: string): string {
  return code.toLowerCase();
}


function toDefaultTarget(conversation: {
  defaultTargetKind: string | null;
  defaultTargetModelId: string | null;
}): ConversationDetail["defaultTarget"] {
  if (
    conversation.defaultTargetKind === "AI_MODEL" &&
    conversation.defaultTargetModelId
  ) {
    return {
      kind: "AI_MODEL",
      modelId: conversation.defaultTargetModelId,
    };
  }
  if (
    conversation.defaultTargetKind === "AI_AUTO" &&
    conversation.defaultTargetModelId === null
  ) {
    return { kind: "AI_AUTO" };
  }
  return null;
}
