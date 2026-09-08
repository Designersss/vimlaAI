import type { PrismaClient } from "@vimla/database";
import { BillingError } from "./errors.js";
import type { MicroRub } from "./money.js";

export interface PolicyDraftInput {
  reason?: string;
}

export class PolicyAdminService {
  constructor(private readonly prisma: PrismaClient) {}

  async listTopupPolicies() {
    return this.prisma.topupPolicyVersion.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createTopupDraft(input: {
    minPurchaseMicroRub: MicroRub;
    maxPurchaseMicroRub: MicroRub;
    usageGrantRatioBps: number;
    createdByUserId?: string;
  }) {
    this.assertTopup(input);
    return this.prisma.topupPolicyVersion.create({
      data: {
        status: "DRAFT",
        minPurchaseMicroRub: input.minPurchaseMicroRub,
        maxPurchaseMicroRub: input.maxPurchaseMicroRub,
        usageGrantRatioBps: input.usageGrantRatioBps,
        effectiveFrom: new Date(),
        createdByUserId: input.createdByUserId ?? null,
        sourceKind: "ADMIN",
      },
    });
  }

  async publishTopup(id: string) {
    const draft = await this.prisma.topupPolicyVersion.findUnique({ where: { id } });
    if (!draft || draft.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a DRAFT top-up policy can be published");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.topupPolicyVersion.updateMany({
        where: { status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
      });
      await tx.topupPolicyVersion.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: now, effectiveFrom: now, effectiveTo: null },
      });
    });
    return this.prisma.topupPolicyVersion.findUniqueOrThrow({ where: { id } });
  }

  async createPaymentFeeDraft(input: {
    provider: string;
    paymentMethod: string;
    feeBps: number;
    feeVatBps: number;
    minimumFeeMicroRub: MicroRub | null;
    fixedFeeMicroRub: MicroRub | null;
    sourceDescription: string;
    sourceQuality: "UNVERIFIED" | "VERIFIED";
    verifiedAt: Date | null;
    createdByUserId?: string;
  }) {
    return this.prisma.paymentFeePolicyVersion.create({
      data: {
        provider: input.provider,
        paymentMethod: input.paymentMethod,
        feeBps: input.feeBps,
        feeVatBps: input.feeVatBps,
        minimumFeeMicroRub: input.minimumFeeMicroRub,
        fixedFeeMicroRub: input.fixedFeeMicroRub,
        status: "DRAFT",
        effectiveFrom: new Date(),
        sourceDescription: input.sourceDescription,
        sourceQuality: input.sourceQuality,
        verifiedAt: input.verifiedAt,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async publishPaymentFee(id: string) {
    const draft = await this.prisma.paymentFeePolicyVersion.findUnique({ where: { id } });
    if (!draft || draft.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a DRAFT payment fee policy can be published");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentFeePolicyVersion.updateMany({
        where: {
          provider: draft.provider,
          paymentMethod: draft.paymentMethod,
          status: "PUBLISHED",
        },
        data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
      });
      await tx.paymentFeePolicyVersion.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: now, effectiveFrom: now, effectiveTo: null },
      });
    });
    return this.prisma.paymentFeePolicyVersion.findUniqueOrThrow({ where: { id } });
  }

  async createFiscalizationDraft(input: {
    provider: string;
    mode: string;
    percentageBps: number | null;
    fixedFeeMicroRub: MicroRub | null;
    sourceDescription: string;
    sourceQuality: "UNVERIFIED" | "VERIFIED";
    verifiedAt: Date | null;
    createdByUserId?: string;
  }) {
    return this.prisma.fiscalizationFeePolicyVersion.create({
      data: {
        ...input,
        status: "DRAFT",
        effectiveFrom: new Date(),
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async publishFiscalization(id: string) {
    const draft = await this.prisma.fiscalizationFeePolicyVersion.findUnique({ where: { id } });
    if (!draft || draft.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a DRAFT fiscalization policy can be published");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalizationFeePolicyVersion.updateMany({
        where: { provider: draft.provider, mode: draft.mode, status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
      });
      await tx.fiscalizationFeePolicyVersion.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: now, effectiveFrom: now, effectiveTo: null },
      });
    });
    return this.prisma.fiscalizationFeePolicyVersion.findUniqueOrThrow({ where: { id } });
  }

  async createTaxReserveDraft(input: {
    reserveBps: number;
    enabled: boolean;
    sourceQuality: "UNVERIFIED" | "ESTIMATE";
    createdByUserId?: string;
  }) {
    return this.prisma.taxReservePolicyVersion.create({
      data: {
        reserveBps: input.reserveBps,
        enabled: input.enabled,
        sourceQuality: input.sourceQuality,
        status: "DRAFT",
        effectiveFrom: new Date(),
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async publishTaxReserve(id: string) {
    const draft = await this.prisma.taxReservePolicyVersion.findUnique({ where: { id } });
    if (!draft || draft.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a DRAFT tax reserve policy can be published");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.taxReservePolicyVersion.updateMany({
        where: { status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
      });
      await tx.taxReservePolicyVersion.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: now, effectiveFrom: now, effectiveTo: null },
      });
    });
    return this.prisma.taxReservePolicyVersion.findUniqueOrThrow({ where: { id } });
  }

  async createGuardrailDraft(input: {
    targetMinimumMarginBps: number;
    projectCreationWindowDays: number | null;
    projectCreationLimitFree: number | null;
    projectCreationLimit199: number | null;
    projectCreationLimit499: number | null;
    projectCreationLimit999: number | null;
    freeActiveProjectReallocationCooldownDays: number | null;
    projectTrashRetentionDays: number | null;
    sourceQuality: "UNVERIFIED" | "VERIFIED";
    createdByUserId?: string;
  }) {
    return this.prisma.businessGuardrailVersion.create({
      data: {
        ...input,
        status: "DRAFT",
        effectiveFrom: new Date(),
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async publishGuardrail(id: string) {
    const draft = await this.prisma.businessGuardrailVersion.findUnique({ where: { id } });
    if (!draft || draft.status !== "DRAFT") {
      throw new BillingError("PLAN_NOT_FOUND", "Only a DRAFT guardrail can be published");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.businessGuardrailVersion.updateMany({
        where: { status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
      });
      await tx.businessGuardrailVersion.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: now, effectiveFrom: now, effectiveTo: null },
      });
    });
    return this.prisma.businessGuardrailVersion.findUniqueOrThrow({ where: { id } });
  }

  async publishedGuardrail() {
    return this.prisma.businessGuardrailVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
  }

  async publishedFeePolicies() {
    return this.prisma.paymentFeePolicyVersion.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ paymentMethod: "asc" }, { effectiveFrom: "desc" }],
    });
  }

  async publishedFiscalization() {
    return this.prisma.fiscalizationFeePolicyVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
  }

  async publishedTaxReserve() {
    return this.prisma.taxReservePolicyVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
  }

  async publishedTopup() {
    return this.prisma.topupPolicyVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
  }

  private assertTopup(input: {
    minPurchaseMicroRub: MicroRub;
    maxPurchaseMicroRub: MicroRub;
    usageGrantRatioBps: number;
  }) {
    if (input.minPurchaseMicroRub <= 0n || input.maxPurchaseMicroRub < input.minPurchaseMicroRub) {
      throw new BillingError("INVALID_TOPUP_AMOUNT", "Invalid top-up bounds");
    }
    if (input.usageGrantRatioBps < 0 || input.usageGrantRatioBps > 10_000) {
      throw new BillingError("INVALID_TOPUP_AMOUNT", "usageGrantRatioBps must be 0-10000");
    }
  }
}
