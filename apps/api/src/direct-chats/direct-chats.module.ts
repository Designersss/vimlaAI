import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import {
  DirectChatDevicesController,
  DirectChatPrekeysController,
  DirectChatsController,
} from "./direct-chats.controller.js";
import { DirectChatsFacade } from "./direct-chats.facade.js";
import { DirectChatsRateLimitGuard } from "./direct-chats-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [DirectChatDevicesController, DirectChatPrekeysController, DirectChatsController],
  providers: [DirectChatsFacade, DirectChatsRateLimitGuard],
  exports: [DirectChatsFacade],
})
export class DirectChatsModule {}
