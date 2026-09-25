import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  createDirectConversationSchema,
  cryptoDevicesResponseSchema,
  cryptoDeviceViewSchema,
  directConversationViewSchema,
  directConversationsResponseSchema,
  directMessageViewSchema,
  directMessagesResponseSchema,
  listDirectConversationsQuerySchema,
  listDirectMessagesQuerySchema,
  prekeyBundlesQuerySchema,
  prekeyBundlesResponseSchema,
  prekeyStatusResponseSchema,
  registerCryptoDeviceSchema,
  replenishOneTimePrekeysSchema,
  rotatePrekeysSchema,
  sendDirectMessageSchema,
  updateDirectChatPrivacySchema,
  type CryptoDeviceView,
  type CryptoDevicesResponse,
  type DirectConversationView,
  type DirectConversationsResponse,
  type DirectMessageView,
  type DirectMessagesResponse,
  type PrekeyBundlesResponse,
  type PrekeyStatusResponse,
} from "@vimla/contracts";
import type { Observable } from "rxjs";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { DirectMentionRoutingService } from "./direct-mention-routing.service.js";
import { DirectChatRealtimeService } from "./direct-chat-realtime.service.js";
import { DirectChatsFacade } from "./direct-chats.facade.js";
import { DirectChatsRateLimitGuard } from "./direct-chats-rate-limit.guard.js";
import { parseRequest } from "./http.js";

@Controller("v1/direct-chats/devices")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, DirectChatsRateLimitGuard)
export class DirectChatDevicesController {
  constructor(@Inject(DirectChatsFacade) private readonly directChats: DirectChatsFacade) {}

  @Get()
  async list(@AuthUser() user: AuthenticatedUser): Promise<CryptoDevicesResponse> {
    this.directChats.assertEnabled();
    const items = await this.directChats.devices.listMine(this.directChats.actor(user));
    return cryptoDevicesResponseSchema.parse({ items });
  }

  @Post()
  @HttpCode(201)
  async register(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<CryptoDeviceView> {
    this.directChats.assertEnabled();
    const input = parseRequest(registerCryptoDeviceSchema, body, "Invalid device payload");
    const device = await this.directChats.devices.register(this.directChats.actor(user), input);
    this.directChats.logMutation("device.register", user.id);
    return cryptoDeviceViewSchema.parse(device);
  }

  @Get(":deviceId/prekeys/status")
  async prekeyStatus(
    @AuthUser() user: AuthenticatedUser,
    @Param("deviceId") deviceId: string,
  ): Promise<PrekeyStatusResponse> {
    this.directChats.assertEnabled();
    return prekeyStatusResponseSchema.parse(
      await this.directChats.devices.prekeyStatus(
        this.directChats.actor(user),
        deviceId,
      ),
    );
  }

  @Post(":deviceId/prekeys/replenish")
  @HttpCode(200)
  async replenishPrekeys(
    @AuthUser() user: AuthenticatedUser,
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
  ): Promise<PrekeyStatusResponse> {
    this.directChats.assertEnabled();
    const input = parseRequest(
      replenishOneTimePrekeysSchema,
      body,
      "Invalid one-time prekey payload",
    );
    const status =
      await this.directChats.devices.replenishOneTimePrekeys(
        this.directChats.actor(user),
        deviceId,
        input,
      );
    this.directChats.logMutation(
      "device.prekeys.replenish",
      user.id,
    );
    return prekeyStatusResponseSchema.parse(status);
  }

  @Post(":deviceId/rotate")
  @HttpCode(200)
  async rotate(
    @AuthUser() user: AuthenticatedUser,
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
  ): Promise<CryptoDeviceView> {
    this.directChats.assertEnabled();
    const input = parseRequest(rotatePrekeysSchema, body, "Invalid prekey payload");
    const device = await this.directChats.devices.rotate(this.directChats.actor(user), deviceId, input);
    this.directChats.logMutation("device.rotate", user.id);
    return cryptoDeviceViewSchema.parse(device);
  }

  @Post(":deviceId/revoke")
  @HttpCode(200)
  async revoke(@AuthUser() user: AuthenticatedUser, @Param("deviceId") deviceId: string): Promise<CryptoDeviceView> {
    this.directChats.assertEnabled();
    const device = await this.directChats.devices.revoke(this.directChats.actor(user), deviceId);
    this.directChats.logMutation("device.revoke", user.id);
    return cryptoDeviceViewSchema.parse(device);
  }
}

@Controller("v1/direct-chats/users")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, DirectChatsRateLimitGuard)
export class DirectChatPrekeysController {
  constructor(@Inject(DirectChatsFacade) private readonly directChats: DirectChatsFacade) {}

  @Get(":userId/prekeys")
  async prekeys(
    @AuthUser() user: AuthenticatedUser,
    @Param("userId") userId: string,
    @Query() query: unknown,
  ): Promise<PrekeyBundlesResponse> {
    this.directChats.assertEnabled();
    await this.directChats.chats.assertCanFetchPrekeys(user.id, userId);
    const parsed = parseRequest(
      prekeyBundlesQuerySchema,
      query,
      "Invalid prekey query",
    );
    const bundles =
      await this.directChats.devices.prekeyBundlesForUser(
        userId,
        parsed.deviceId,
      );
    return prekeyBundlesResponseSchema.parse({ userId, bundles });
  }
}

@Controller("v1/direct-chats")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, DirectChatsRateLimitGuard)
export class DirectChatsController {
  private readonly logger = new Logger(DirectChatsController.name);

  constructor(
    @Inject(DirectChatsFacade) private readonly directChats: DirectChatsFacade,
    @Inject(DirectMentionRoutingService) private readonly mentionRouting: DirectMentionRoutingService,
    @Inject(DirectChatRealtimeService) private readonly realtime: DirectChatRealtimeService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<DirectConversationView> {
    this.directChats.assertEnabled();
    const input = parseRequest(createDirectConversationSchema, body, "Invalid Direct Chat payload");
    const created = await this.directChats.chats.create(this.directChats.actor(user), input);
    this.directChats.logMutation("conversation.create", user.id, created.id);
    return directConversationViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<DirectConversationsResponse> {
    this.directChats.assertEnabled();
    const parsed = parseRequest(listDirectConversationsQuerySchema, query, "Invalid Direct Chat query");
    const page = await this.directChats.chats.list(this.directChats.actor(user), {
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return directConversationsResponseSchema.parse(page);
  }

  @Sse("events")
  events(@AuthUser() user: AuthenticatedUser): Observable<MessageEvent> {
    this.directChats.assertEnabled();
    return this.realtime.stream(user.id);
  }

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
    const input = parseRequest(sendDirectMessageSchema, body, "Invalid Direct Chat message payload");
    const resolvedMentions = await this.mentionRouting.resolve({
      userId: user.id,
      conversationId: id,
      mentions: input.mentions,
    });
    this.mentionRouting.assertMessageKind(input.kind, resolvedMentions);
    const created = await this.directChats.chats.send(
      this.directChats.actor(user),
      id,
      input,
      resolvedMentions,
    );
    try {
      const participants = await this.directChats.chats.participants(user.id, id);
      await this.realtime.publish(
        participants.map((participant) => participant.userId),
        {
          type: "direct_message",
          conversationId: created.conversationId,
          messageId: created.id,
          senderUserId: created.senderUserId,
          kind: created.kind,
          createdAt: created.createdAt,
        },
      );
    } catch (error: unknown) {
      this.logger.warn({
        msg: "direct_chats.realtime_notify_failed_after_commit",
        conversationId: created.conversationId,
        messageId: created.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    this.directChats.logMutation("message.send", user.id, id);
    return directMessageViewSchema.parse(created);
  }
}
