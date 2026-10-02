import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  createDirectConversationSchema,
  cryptoDevicesResponseSchema,
  cryptoDeviceViewSchema,
  directConversationViewSchema,
  directMessageViewSchema,
  directMessagesResponseSchema,
  listDirectMessagesQuerySchema,
  prekeyBundlesResponseSchema,
  registerCryptoDeviceSchema,
  rotatePrekeysSchema,
  sendDirectMessageSchema,
  updateDirectChatPrivacySchema,
  type CryptoDeviceView,
  type CryptoDevicesResponse,
  type DirectConversationView,
  type DirectMessageView,
  type DirectMessagesResponse,
  type PrekeyBundlesResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { DirectMentionRoutingService } from "./direct-mention-routing.service.js";
import { DirectChatsFacade } from "./direct-chats.facade.js";
import { DirectChatsRateLimitGuard } from "./direct-chats-rate-limit.guard.js";
import { parseRequest } from "./http.js";

@Controller("v1/direct-chats/devices")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, DirectChatsRateLimitGuard)
export class DirectChatDevicesController {
  constructor(@Inject(DirectChatsFacade) private readonly directChats: DirectChatsFacade) {}

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<DirectConversationView> {
    this.directChats.assertEnabled();
    return directConversationViewSchema.parse(await this.directChats.chats.get(this.directChats.actor(user), id));
  }

  @Patch(":id/privacy")
  async privacy(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<DirectConversationView> {
    this.directChats.assertEnabled();
    const input = parseRequest(updateDirectChatPrivacySchema, body, "Invalid privacy payload");
    const updated = await this.directChats.chats.updatePrivacy(this.directChats.actor(user), id, input);
    this.directChats.logMutation("conversation.privacy", user.id, id);
    return directConversationViewSchema.parse(updated);
  }

  @Post(":id/read")
  @HttpCode(200)
  async markRead(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<DirectConversationView> {
    this.directChats.assertEnabled();
    const updated = await this.directChats.chats.markRead(this.directChats.actor(user), id);
    this.directChats.logMutation("conversation.read", user.id, id);
    return directConversationViewSchema.parse(updated);
  }

  @Get(":id/messages")
  async messages(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<DirectMessagesResponse> {
    this.directChats.assertEnabled();
    const parsed = parseRequest(listDirectMessagesQuerySchema, query, "Invalid Direct Chat message query");
    const page = await this.directChats.chats.listMessages(this.directChats.actor(user), id, {
      limit: parsed.limit,
      cursor: parsed.cursor,
      deviceId: parsed.deviceId,
    });
    return directMessagesResponseSchema.parse(page);
  }

  @Post(":id/messages")
  @HttpCode(201)
  async send(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<DirectMessageView> {
    this.directChats.assertEnabled();
    const input = parseRequest(
      sendDirectMessageSchema,
      body,
      "Invalid Direct Chat message payload",
    );
    const actor = this.directChats.actor(user);
    const preflight =
      await this.directChats.chats.preflightSend(
        actor,
        id,
        input,
      );
    if (preflight.replay) {
      return directMessageViewSchema.parse(
        preflight.replay,
      );
    }

    const resolvedMentions = await this.mentionRouting.resolve({
      userId: user.id,
      conversationId: id,
      mentions: input.mentions,
    });
    this.mentionRouting.assertMessageKind(
      input.kind,
      resolvedMentions,
    );
    const result = await this.directChats.chats.sendWithStatus(
      actor,
      id,
      input,
      resolvedMentions,
    );
    const created = result.message;
    if (!result.replayed) {
      this.directChats.logMutation(
        "message.send",
        user.id,
        id,
      );
    }
    return directMessageViewSchema.parse(created);
  }


}
