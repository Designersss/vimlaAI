import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InstallationsModule } from "../installations/installations.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { RealtimeGatewayService } from "./realtime-gateway.service.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  imports: [
    PersistenceModule,
    AuthModule,
    InstallationsModule,
  ],
  providers: [RealtimeService, RealtimeGatewayService],
  exports: [RealtimeService, RealtimeGatewayService],
})
export class RealtimeModule {}
