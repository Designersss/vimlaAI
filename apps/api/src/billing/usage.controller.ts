import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import { microRubToJson } from "@vimla/billing";
import { usageResponseSchema, type UsageResponse } from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { BillingService } from "./billing.service.js";

@Controller("v1")
export class UsageController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("usage")
  @UseGuards(AuthGuard)
  async getUsage(@AuthUser() user: AuthenticatedUser): Promise<UsageResponse> {
    const snapshot = await this.billing.engine.getUsageSnapshot(user.id);
    return usageResponseSchema.parse({
      monthly: serializeGroup(snapshot.monthly),
      topup: serializeGroup(snapshot.topup),
    });
  }
}

function serializeGroup(group: {
  totalMicroRub: bigint;
  spentMicroRub: bigint;
  reservedMicroRub: bigint;
  remainingMicroRub: bigint;
  usedPercent: number;
}) {
  return {
    totalMicroRub: microRubToJson(group.totalMicroRub),
    spentMicroRub: microRubToJson(group.spentMicroRub),
    reservedMicroRub: microRubToJson(group.reservedMicroRub),
    remainingMicroRub: microRubToJson(group.remainingMicroRub),
    usedPercent: group.usedPercent,
  };
}
