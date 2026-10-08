import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { TrustController } from "./trust.controller.js";
import { TrustFacade } from "./trust.facade.js";
import { TrustRateLimitGuard } from "./trust-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [TrustController],
  providers: [TrustFacade, TrustRateLimitGuard],
  exports: [TrustFacade],
})
export class TrustModule {}
