import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingService } from "./billing.service.js";
import { PlansController } from "./plans.controller.js";
import { SubscriptionController } from "./subscription.controller.js";
import { UsageController } from "./usage.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { TbankWebhookController } from "./tbank-webhook.controller.js";
import { PaymentCheckoutRateLimitGuard } from "./payment-checkout.rate-limit.js";
import { TbankWebhookRateLimitGuard } from "./tbank-webhook.rate-limit.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [
    PlansController,
    UsageController,
    SubscriptionController,
    PaymentsController,
    TbankWebhookController,
  ],
  providers: [BillingService, PaymentCheckoutRateLimitGuard, TbankWebhookRateLimitGuard],
  exports: [BillingService],
})
export class BillingModule {}
