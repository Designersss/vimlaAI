import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { OrchestrationModule } from "../orchestration/orchestration.module.js";
import { MemoryController } from "./memory.controller.js";
import { MemoryFacade } from "./memory.facade.js";
import { MemoryRateLimitGuard } from "./memory-rate-limit.guard.js";
import { MemoryMaintenanceService } from "./memory-maintenance.service.js";

@Module({
  imports: [PersistenceModule, AuthModule, OrchestrationModule],
  controllers: [MemoryController],
  providers: [
    MemoryFacade,
    MemoryRateLimitGuard,
    MemoryMaintenanceService,
  ],
  exports: [MemoryFacade, MemoryMaintenanceService],
})
export class MemoryModule {}
