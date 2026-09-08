import { Module } from "@nestjs/common";
import { AuthModule } from "./auth.module.js";
import { DevNotificationsController } from "./dev-notifications.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [DevNotificationsController],
})
export class DevNotificationsModule {}
