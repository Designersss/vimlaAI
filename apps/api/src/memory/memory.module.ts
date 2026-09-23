import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { MemoryController } from "./memory.controller.js";
import { MemoryFacade } from "./memory.facade.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [MemoryController],
  providers: [MemoryFacade],
  exports: [MemoryFacade],
})
export class MemoryModule {}
