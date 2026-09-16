import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { OrchestrationController } from "./orchestration.controller.js";
import { OrchestrationService } from "./orchestration.service.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [OrchestrationController],
  providers: [OrchestrationService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
