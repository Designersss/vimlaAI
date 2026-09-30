import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  imports: [PersistenceModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
