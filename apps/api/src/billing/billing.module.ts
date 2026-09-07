import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingService } from "./billing.service.js";
import { PlansController } from "./plans.controller.js";
import { SubscriptionController } from "./subscription.controller.js";
import { UsageController } from "./usage.controller.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [PlansController, UsageController, SubscriptionController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
