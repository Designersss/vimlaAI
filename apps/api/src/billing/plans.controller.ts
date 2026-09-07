import { Controller, Get, Inject } from "@nestjs/common";
import { microRubToJson } from "@vimla/billing";
import { plansResponseSchema, type PlansResponse } from "@vimla/contracts";
import { BillingService } from "./billing.service.js";

@Controller("v1")
export class PlansController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("plans")
  async listPlans(): Promise<PlansResponse> {
    const plans = await this.billing.engine.listRetailPlans();
    return plansResponseSchema.parse({
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        priceMicroRub: microRubToJson(plan.priceMicroRub),
      })),
    });
  }
}
