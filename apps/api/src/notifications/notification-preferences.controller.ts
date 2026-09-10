import { Body, Controller, Get, Inject, Patch, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  notificationPreferencesViewSchema,
  updateNotificationPreferencesSchema,
  type NotificationPreferencesView,
} from "@vimla/contracts";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { parseNotificationRequest } from "./http.js";
import { NotificationRateLimitGuard } from "./notification-rate-limit.guard.js";
import { NotificationsFacade } from "./notifications.facade.js";

@Controller("v1/notification-preferences")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, NotificationRateLimitGuard)
export class NotificationPreferencesController {
  constructor(
    @Inject(NotificationsFacade) private readonly notifications: NotificationsFacade,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  @Get()
  async get(@AuthUser() user: AuthenticatedUser): Promise<NotificationPreferencesView> {
    return notificationPreferencesViewSchema.parse(await this.notifications.preferences.get(user.id));
  }

  @Patch()
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<NotificationPreferencesView> {
    const input = parseNotificationRequest(
      updateNotificationPreferencesSchema,
      body,
      "Invalid notification preference payload",
    );
    return notificationPreferencesViewSchema.parse(
      await this.notifications.preferences.update(user.id, input, this.config.authDefaultLocale),
    );
  }
}
