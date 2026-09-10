import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AiModule } from "../ai/ai.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { WorkspaceModule } from "../workspace/workspace.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OperatorRunsController, OperatorThreadController } from "./operator.controller.js";
import { OperatorService } from "./operator.service.js";
import { OperatorRateLimitGuard } from "./operator-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule, AiModule, WorkspaceModule, NotificationsModule],
  controllers: [OperatorThreadController, OperatorRunsController],
  providers: [OperatorService, OperatorRateLimitGuard],
  exports: [OperatorService],
})
export class OperatorModule {}
