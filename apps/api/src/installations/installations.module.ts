import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { ClientInstallationsController } from "./client-installations.controller.js";
import { ClientInstallationsService } from "./client-installations.service.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [ClientInstallationsController],
  providers: [ClientInstallationsService],
  exports: [ClientInstallationsService],
})
export class InstallationsModule {}
