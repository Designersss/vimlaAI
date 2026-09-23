import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { OrchestrationController } from "./orchestration.controller.js";
import { OrchestrationService } from "./orchestration.service.js";
import {
  createSemanticPlannerModel,
  SEMANTIC_PLANNER_MODEL,
} from "./semantic-planner.adapter.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [OrchestrationController],
  providers: [
    OrchestrationService,
    {
      provide: SEMANTIC_PLANNER_MODEL,
      inject: [API_CONFIG],
      useFactory: (config: ApiRuntimeConfig) => createSemanticPlannerModel(config),
    },
  ],
  exports: [OrchestrationService, SEMANTIC_PLANNER_MODEL],
})
export class OrchestrationModule {}
