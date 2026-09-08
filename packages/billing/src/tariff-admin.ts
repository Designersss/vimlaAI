import type { PrismaClient } from "@vimla/database";
import { BillingError } from "./errors.js";
import {
  assertWritableEntitlementKey,
  decodeEntitlement,
  encodeEntitlement,
  type PlanEntitlementRecord,
} from "./entitlements.js";
import { simulateTariffEconomics, type TariffSimulationAssumptions } from "./tariff-simulator.js";
import { estimateAcquiringFee, estimateFiscalizationFee, estimateTaxReserve } from "./fee-estimate.js";
import { marginBpsFloor, topupProviderBudgetMicroRub, type MicroRub } from "./money.js";

export interface DraftPlanInput {
  planId: string;
  priceMicroRub: MicroRub;
  monthlyUsageGrantMicroRub: MicroRub;
  subscriptionPeriodDays: number;
  entitlements: PlanEntitlementRecord[];
}

export interface PublishConfirmation {
  acknowledgeNegativeOrLowMargin: boolean;
  reason: string;
  typedPlanCode: string;
}

export class TariffAdminService {
  constructor(private readonly prisma: PrismaClient) {}

  async createPlanDraft(input: DraftPlanInput, createdByUserId?: string) {
    this.assertWritableEntitlements(input.entitlements);
    const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan) {
      throw new BillingError("PLAN_NOT_FOUND", "Plan was not found");
    }
    const draft = await this.prisma.planVersion.create({
      data: {
        planId: plan.id,
        priceMicroRub: input.priceMicroRub,
        providerBudgetMicroRub: input.monthlyUsageGrantMicroRub,
        providerCostRatioBps: 0,
        subscriptionPeriodDays: input.subscriptionPeriodDays,
        status: "DRAFT",
        validFrom: new Date(),
        createdByUserId: createdByUserId ?? null,
      },
    });
    await this.replaceEntitlements(draft.id, input.entitlements);
    return this.loadPlanVersion(draft.id);
  }

  async updatePlanDraft(planVersionId: string, input: Omit<DraftPlanInput, "planId">) {
    const version = await this.requireDraft(planVersionId);
    this.assertWritableEntitlements(input.entitlements);
    await this.prisma.planVersion.update({
      where: { id: version.id },
      data: {
        priceMicroRub: input.priceMicroRub,
        providerBudgetMicroRub: input.monthlyUsageGrantMicroRub,
        subscriptionPeriodDays: input.subscriptionPeriodDays,
      },
    });
    await this.replaceEntitlements(version.id, input.entitlements);
    return this.loadPlanVersion(version.id);
  }

  async simulatePlanVersion(planVersionId: string, assumptions: Omit<TariffSimulationAssumptions, "priceMicroRub" | "monthlyUsageGrantMicroRub">) {
    const version = await this.loadPlanVersion(planVersionId);
    return simulateTariffEconomics({
      ...assumptions,
      priceMicroRub: version.priceMicroRub,
      monthlyUsageGrantMicroRub: version.monthlyUsageGrantMicroRub,
    });
  }

  async publishPlanVersion(
    planVersionId: string,
    confirmation: PublishConfirmation | null,
    guardrail: { targetMinimumMarginBps: number; worstCaseMarginBps: number | null },
  ) {
    const version = await this.requireDraft(planVersionId);
    const loaded = await this.loadPlanVersion(version.id);
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: loaded.planId } });
    this.assertWritableEntitlements(loaded.entitlements);
    const needsConfirmation =
      guardrail.worstCaseMarginBps === null ||
      guardrail.worstCaseMarginBps < guardrail.targetMinimumMarginBps;
    if (needsConfirmation) {
      if (
        !confirmation?.acknowledgeNegativeOrLowMargin ||
        !confirmation.reason.trim() ||
        confirmation.typedPlanCode !== plan.code
      ) {
        throw new BillingError(
          "POLICY_CONFIRMATION_REQUIRED",
          "Publishing below the target margin requires step-up confirmation, a reason, and the plan code",
        );
      }
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.planVersion.updateMany({
        where: { planId: plan.id, status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now, validTo: now },
      });
      await tx.planVersion.update({
        where: { id: loaded.id },
        data: { status: "PUBLISHED", publishedAt: now, validFrom: now, validTo: null },
      });
      if (plan.code !== "FREE" && !plan.active) {
        await tx.plan.update({ where: { id: plan.id }, data: { active: true } });
      }
    });
    return this.loadPlanVersion(version.id);
  }

  async retirePlanVersion(planVersionId: string) {
    const version = await this.prisma.planVersion.findUnique({ where: { id: planVersionId } });
    if (!version || version.status !== "PUBLISHED") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a published plan version can be retired");
    }
    const now = new Date();
    return this.prisma.planVersion.update({
      where: { id: version.id },
      data: { status: "RETIRED", retiredAt: now, validTo: now },
    });
  }

  simulateTopup(input: {
    amountMicroRub: MicroRub;
    usageGrantRatioBps: bigint;
    paymentFees: TariffSimulationAssumptions["paymentFees"];
    fiscalization?: TariffSimulationAssumptions["fiscalization"];
    taxReserveBps?: bigint;
    targetMinimumMarginBps?: number;
  }) {
    const grant = topupProviderBudgetMicroRub(input.amountMicroRub, input.usageGrantRatioBps);
    const methods = simulateTariffEconomics({
      priceMicroRub: input.amountMicroRub,
      monthlyUsageGrantMicroRub: grant,
      paymentFees: input.paymentFees,
      fiscalization: input.fiscalization,
      taxReserveBps: input.taxReserveBps,
      targetMinimumMarginBps: input.targetMinimumMarginBps,
    });
    return { grantMicroRub: grant, ...methods };
  }

  estimateFeePreview(
    amountMicroRub: MicroRub,
    policy: {
      feeBps: bigint;
      feeVatBps: bigint;
      minimumFeeMicroRub: MicroRub | null;
      fixedFeeMicroRub: MicroRub | null;
    },
    fiscal?: { percentageBps: bigint | null; fixedFeeMicroRub: MicroRub | null },
    taxBps?: bigint,
  ) {
    const acquiring = estimateAcquiringFee(amountMicroRub, policy);
    const fiscalization = fiscal ? estimateFiscalizationFee(amountMicroRub, fiscal) : 0n;
    const tax = taxBps === undefined ? null : estimateTaxReserve(amountMicroRub, taxBps);
    const contribution =
      amountMicroRub - acquiring.feeMicroRub - acquiring.vatMicroRub - fiscalization - (tax ?? 0n);
    return {
      acquiring,
      fiscalization,
      tax,
      contribution,
      marginBps: marginBpsFloor(contribution, amountMicroRub),
    };
  }

  private async requireDraft(planVersionId: string) {
    const version = await this.prisma.planVersion.findUnique({ where: { id: planVersionId } });
    if (!version || version.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only DRAFT plan versions can be edited");
    }
    return version;
  }

  private assertWritableEntitlements(entitlements: readonly PlanEntitlementRecord[]): void {
    for (const item of entitlements) {
      try {
        assertWritableEntitlementKey(item.key);
      } catch (error) {
        throw new BillingError(
          "ENTITLEMENT_INVALID",
          error instanceof Error ? error.message : `Invalid entitlement key: ${item.key}`,
        );
      }
    }
  }

  private async replaceEntitlements(planVersionId: string, entitlements: PlanEntitlementRecord[]) {
    await this.prisma.planEntitlement.deleteMany({ where: { planVersionId } });
    for (const entitlement of entitlements) {
      const encoded = encodeEntitlement(entitlement.value);
      await this.prisma.planEntitlement.create({
        data: {
          planVersionId,
          key: entitlement.key,
          valueKind: encoded.valueKind,
          unlimited: encoded.unlimited,
          intValue: encoded.intValue,
          boolValue: encoded.boolValue,
        },
      });
    }
  }

  private async loadPlanVersion(id: string) {
    const version = await this.prisma.planVersion.findUniqueOrThrow({
      where: { id },
      include: { plan: true, entitlements: true },
    });
    return {
      id: version.id,
      planId: version.planId,
      planCode: version.plan.code,
      status: version.status,
      priceMicroRub: version.priceMicroRub,
      monthlyUsageGrantMicroRub: version.providerBudgetMicroRub,
      subscriptionPeriodDays: version.subscriptionPeriodDays,
      publishedAt: version.publishedAt,
      retiredAt: version.retiredAt,
      entitlements: version.entitlements.map(decodeEntitlement),
    };
  }
}
