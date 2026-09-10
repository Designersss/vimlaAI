import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { NotificationPreferencesController } from "./notification-preferences.controller.js";
import { NotificationRateLimitGuard } from "./notification-rate-limit.guard.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsFacade } from "./notifications.facade.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsFacade, NotificationRateLimitGuard],
})
export class NotificationsModule {}
