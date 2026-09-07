import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { BillingModule } from "./billing.module.js";
import { MockPurchaseController } from "./mock-purchase.controller.js";
import { MockPurchaseRateLimitGuard } from "./mock-purchase.rate-limit.js";

@Module({
  imports: [PersistenceModule, BillingModule, AuthModule],
  controllers: [MockPurchaseController],
  providers: [MockPurchaseRateLimitGuard],
})
export class DevBillingModule {}
