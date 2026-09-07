import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import { subscriptionResponseSchema, type SubscriptionResponse } from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { BillingService } from "./billing.service.js";

@Controller("v1")
export class SubscriptionController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("subscription")
  @UseGuards(AuthGuard)
  async getSubscription(
    @AuthUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponse> {
    const subscription = await this.billing.engine.getActiveSubscription(user.id);
    return subscriptionResponseSchema.parse({
      subscription: subscription
        ? {
            id: subscription.id,
            status: "ACTIVE",
            planCode: subscription.planCode,
            planName: subscription.planName,
            periodStart: subscription.periodStart.toISOString(),
            periodEnd: subscription.periodEnd.toISOString(),
          }
        : null,
    });
  }
}
