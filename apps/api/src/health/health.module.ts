import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
