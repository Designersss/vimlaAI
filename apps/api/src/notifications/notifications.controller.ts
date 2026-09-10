import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  listNotificationsQuerySchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
  userNotificationViewSchema,
  type NotificationsResponse,
  type UnreadCountResponse,
  type UserNotificationView,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { parseNotificationRequest } from "./http.js";
import { NotificationRateLimitGuard } from "./notification-rate-limit.guard.js";
import { NotificationsFacade } from "./notifications.facade.js";

@Controller("v1/notifications")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, NotificationRateLimitGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsFacade) private readonly notifications: NotificationsFacade) {}

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<NotificationsResponse> {
    const parsed = parseNotificationRequest(listNotificationsQuerySchema, query, "Invalid notification query");
    const page = await this.notifications.inbox.list(user.id, {
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return notificationsResponseSchema.parse(page);
  }

  @Get("unread-count")
  async unreadCount(@AuthUser() user: AuthenticatedUser): Promise<UnreadCountResponse> {
    return unreadCountResponseSchema.parse(await this.notifications.inbox.unreadCount(user.id));
  }

  @Post("read-all")
  @HttpCode(200)
  async markAllRead(@AuthUser() user: AuthenticatedUser): Promise<UnreadCountResponse> {
    await this.notifications.inbox.markAllRead(user.id);
    return unreadCountResponseSchema.parse({ count: 0 });
  }

  @Patch(":id/read")
  async markRead(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<UserNotificationView> {
    return userNotificationViewSchema.parse(await this.notifications.inbox.markRead(user.id, id));
  }
}
