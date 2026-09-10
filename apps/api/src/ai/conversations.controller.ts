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
import { TextChatService } from "./text-chat.service.js";
import { buildOperatorRunView } from "../operator/view.js";

@Controller("v1/conversations")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard)
export class ConversationsController {
  constructor(
    @Inject(TextChatService) private readonly chat: TextChatService,
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

    const conversation = await this.chat.createConversation(user.id, parsed.data.title);
    return conversationCreatedSchema.parse({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
    });
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser): Promise<ConversationsResponse> {
    const conversations = await this.chat.listConversations(user.id);
    return conversationsResponseSchema.parse({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
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
    return conversationDetailSchema.parse({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
        operatorRun: message.operatorRun ? buildOperatorRunView(message.operatorRun, null) : null,
      })),
    });
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

    await this.chat.assertTextEnabled();

    await this.chat.getConversation(user.id, conversationId);

    reply.hijack();
    // hijack() skips Nest CORS; the browser reads this cross-origin SSE body.
    reply.raw.writeHead(200, sseResponseHeaders(this.config.webOrigin));
    reply.raw.write(":\n\n");

    const response = reply.raw;
    const sink = {
      isClientOpen: () => !response.writableEnded,
      write: (chunk: string) => {
        if (!response.writableEnded) {
          response.write(chunk);
        }
      },
    };

    try {
      await this.chat.streamMessage({
        userId: user.id,
        conversationId,
        body: parsed.data,
        correlationId: String(request.id),
        sink,
      });
    } catch (error: unknown) {
      const payload = publicStreamError(error, String(request.id));
      if (!response.writableEnded) {
        response.write(encodeVimlaSse("error", payload));
      }
    } finally {
      if (!response.writableEnded) {
        response.end();
      }
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
