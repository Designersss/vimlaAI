import type { Prisma, PrismaClient } from "@vimla/database";
import { decodeEntitlement, isTopupAllowed, type PlanEntitlementRecord } from "./entitlements.js";
import { BillingError } from "./errors.js";
import type { MicroRub } from "./money.js";

export const FREE_PLAN_CODE = "FREE";

export interface EffectivePlan {
  planCode: string;
  planName: string;
  planVersionId: string;
  priceMicroRub: MicroRub;
  monthlyUsageGrantMicroRub: MicroRub;
  subscriptionPeriodDays: number;
  source: "SUBSCRIPTION" | "FREE_FALLBACK";
  subscriptionId: string | null;
  periodEnd: Date | null;
  entitlements: PlanEntitlementRecord[];
  topupAllowed: boolean;
}

export class EffectivePlanResolver {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async resolve(userId: string, now = new Date()): Promise<EffectivePlan> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE", periodEnd: { gt: now } },
      include: { planVersion: { include: { plan: true, entitlements: true } } },
      orderBy: { periodEnd: "desc" },
    });
    if (subscription) {
      const entitlements = subscription.planVersion.entitlements.map(decodeEntitlement);
      return {
        planCode: subscription.planVersion.plan.code,
        planName: subscription.planVersion.plan.name,
        planVersionId: subscription.planVersion.id,
        priceMicroRub: subscription.planVersion.priceMicroRub,
        monthlyUsageGrantMicroRub: subscription.planVersion.providerBudgetMicroRub,
        subscriptionPeriodDays: subscription.planVersion.subscriptionPeriodDays,
        source: "SUBSCRIPTION",
        subscriptionId: subscription.id,
        periodEnd: subscription.periodEnd,
        entitlements,
        topupAllowed: isTopupAllowed(entitlements),
      };
    }

    const free = await this.prisma.plan.findUnique({
      where: { code: FREE_PLAN_CODE },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          include: { entitlements: true },
          orderBy: { validFrom: "desc" },
        },
      },
    });
    const version = free?.versions.find(
      (item) => item.validFrom <= now && (item.validTo === null || item.validTo > now),
    );
    if (!free || !version) {
      throw new BillingError("PLAN_NOT_FOUND", "FREE plan version is not published");
    }
    const entitlements = version.entitlements.map(decodeEntitlement);
    return {
      planCode: free.code,
      planName: free.name,
      planVersionId: version.id,
      priceMicroRub: version.priceMicroRub,
      monthlyUsageGrantMicroRub: version.providerBudgetMicroRub,
      subscriptionPeriodDays: version.subscriptionPeriodDays,
      source: "FREE_FALLBACK",
      subscriptionId: null,
      periodEnd: null,
      entitlements,
      topupAllowed: isTopupAllowed(entitlements),
    };
  }
}
