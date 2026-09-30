import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { SyncCursorCodec } from "./sync-cursor.codec.js";
import { SyncController } from "./sync.controller.js";
import { SyncRateLimitGuard } from "./sync-rate-limit.guard.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [SyncController],
  providers: [SyncCursorCodec, SyncRateLimitGuard, SyncService],
})
export class SyncModule {}
