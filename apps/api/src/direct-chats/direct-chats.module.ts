import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import {
  DirectChatDevicesController,
  DirectChatPrekeysController,
  DirectChatsController,
} from "./direct-chats.controller.js";
import { DirectMentionRoutingService } from "./direct-mention-routing.service.js";
import { DirectChatsFacade } from "./direct-chats.facade.js";
import { DirectChatsRateLimitGuard } from "./direct-chats-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [DirectChatDevicesController, DirectChatPrekeysController, DirectChatsController],
  providers: [DirectMentionRoutingService, DirectChatsFacade, DirectChatsRateLimitGuard],
  exports: [DirectChatsFacade],
})
export class DirectChatsModule {}
