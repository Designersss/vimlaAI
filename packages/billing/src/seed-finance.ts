import { type Prisma, type PrismaClient } from "@vimla/database";

type SeedFinanceClient = PrismaClient | Prisma.TransactionClient;
import { encodeEntitlement, type EntitlementValue, type PlanEntitlementRecord } from "./entitlements.js";
import { FREE_PLAN_CODE } from "./effective-plan.js";
import { rubToMicroRub } from "./money.js";
import { DEFAULT_BILLING_POLICY } from "./policy.js";

const SHARED_FEATURE_ENTITLEMENTS: PlanEntitlementRecord[] = [
  { key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: true } },
  { key: "ai.manualModelSelection", value: { kind: "BOOLEAN", value: true } },
  { key: "ai.auto.minimum", value: { kind: "TBD" } },
  { key: "ai.auto.medium", value: { kind: "TBD" } },
  { key: "ai.auto.maximum", value: { kind: "TBD" } },
  { key: "storage.maxBytes", value: { kind: "TBD" } },
];

const FREE_ENTITLEMENTS: PlanEntitlementRecord[] = [
  { key: "projects.ownedActiveMax", value: { kind: "COUNT", unlimited: false, value: 1n } },
  { key: "projects.externalActiveMax", value: { kind: "COUNT", unlimited: false, value: 2n } },
  { key: "projects.membersPerOwnedProjectMax", value: { kind: "COUNT", unlimited: false, value: 2n } },
  ...SHARED_FEATURE_ENTITLEMENTS,
];

interface DraftTier {
  code: string;
  name: string;
  priceRub: bigint;
  owned: { unlimited: boolean; value?: bigint };
  external: EntitlementValue;
  members: bigint;
}

const TARGET_TIER_DRAFTS: DraftTier[] = [
  {
    code: "T199",
    name: "199",
    priceRub: 199n,
    owned: { unlimited: false, value: 3n },
    external: { kind: "COUNT", unlimited: false, value: 4n },
    members: 4n,
  },
  {
    code: "T499",
    name: "499",
    priceRub: 499n,
    owned: { unlimited: false, value: 6n },
    external: { kind: "TBD" },
    members: 6n,
  },
  {
    code: "T999",
    name: "999",
    priceRub: 999n,
    owned: { unlimited: true },
    external: { kind: "TBD" },
    members: 15n,
  },
];

export async function seedFinanceFoundation(
  prisma: SeedFinanceClient,
  now = new Date(),
): Promise<void> {
  await seedFreePlan(prisma, now);
  await seedDraftTiers(prisma, now);
  await seedTopupPolicy(prisma, now);
}

async function seedFreePlan(prisma: SeedFinanceClient, now: Date): Promise<void> {
  const plan = await prisma.plan.upsert({
    where: { code: FREE_PLAN_CODE },
    update: { name: "Free", active: true },
    create: { code: FREE_PLAN_CODE, name: "Free", active: true },
  });

  const published = await prisma.planVersion.findFirst({
    where: { planId: plan.id, status: "PUBLISHED", priceMicroRub: 0n },
    include: { entitlements: true },
    orderBy: { validFrom: "desc" },
  });
  if (published) {
    const hasCanonical = published.entitlements.some((row) => row.key === "projects.ownedActiveMax");
    if (hasCanonical) {
      return;
    }
    const next = await prisma.planVersion.create({
      data: {
        planId: plan.id,
        priceMicroRub: 0n,
        providerBudgetMicroRub: 0n,
        providerCostRatioBps: 0,
        subscriptionPeriodDays: 30,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
      },
    });
    await replaceEntitlements(prisma, next.id, FREE_ENTITLEMENTS);
    await prisma.planVersion.update({
      where: { id: next.id },
      data: { status: "PUBLISHED", publishedAt: now },
    });
    await prisma.planVersion.update({
      where: { id: published.id },
      data: { status: "RETIRED", retiredAt: now, validTo: now },
    });
    return;
  }

  const draft = await prisma.planVersion.create({
    data: {
      planId: plan.id,
      priceMicroRub: 0n,
      providerBudgetMicroRub: 0n,
      providerCostRatioBps: 0,
      subscriptionPeriodDays: 30,
      status: "DRAFT",
      validFrom: now,
      validTo: null,
    },
  });
  await replaceEntitlements(prisma, draft.id, FREE_ENTITLEMENTS);
  await prisma.planVersion.update({
    where: { id: draft.id },
    data: { status: "PUBLISHED", publishedAt: now },
  });
}

async function seedDraftTiers(prisma: SeedFinanceClient, now: Date): Promise<void> {
  for (const tier of TARGET_TIER_DRAFTS) {
    const plan = await prisma.plan.upsert({
      where: { code: tier.code },
      update: { name: tier.name, active: false },
      create: { code: tier.code, name: tier.name, active: false },
    });
    const existing = await prisma.planVersion.findFirst({
      where: { planId: plan.id, status: "DRAFT", priceMicroRub: rubToMicroRub(tier.priceRub) },
    });
    const entitlements: PlanEntitlementRecord[] = [
      {
        key: "projects.ownedActiveMax",
        value: tier.owned.unlimited
          ? { kind: "COUNT", unlimited: true }
          : { kind: "COUNT", unlimited: false, value: tier.owned.value ?? 0n },
      },
      { key: "projects.externalActiveMax", value: tier.external },
      {
        key: "projects.membersPerOwnedProjectMax",
        value: { kind: "COUNT", unlimited: false, value: tier.members },
      },
      ...SHARED_FEATURE_ENTITLEMENTS,
    ];
    if (existing) {
      await replaceEntitlements(prisma, existing.id, entitlements);
      continue;
    }
    const draft = await prisma.planVersion.create({
      data: {
        planId: plan.id,
        priceMicroRub: rubToMicroRub(tier.priceRub),
        providerBudgetMicroRub: 0n,
        providerCostRatioBps: 0,
        subscriptionPeriodDays: 30,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
      },
    });
    await replaceEntitlements(prisma, draft.id, entitlements);
  }
}

async function seedTopupPolicy(prisma: SeedFinanceClient, now: Date): Promise<void> {
  const published = await prisma.topupPolicyVersion.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
  });
  if (published) {
    return;
  }
  await prisma.topupPolicyVersion.create({
    data: bootstrapTopupPolicyData(now),
  });
}

export async function republishBootstrapTopupPolicy(
  prisma: SeedFinanceClient,
  now = new Date(),
): Promise<void> {
  await prisma.topupPolicyVersion.updateMany({
    where: { status: "PUBLISHED" },
    data: { status: "RETIRED", retiredAt: now, effectiveTo: now },
  });
  await prisma.topupPolicyVersion.create({
    data: bootstrapTopupPolicyData(now),
  });
}

function bootstrapTopupPolicyData(now: Date) {
  return {
    status: "PUBLISHED" as const,
    minPurchaseMicroRub: DEFAULT_BILLING_POLICY.minTopupMicroRub,
    maxPurchaseMicroRub: DEFAULT_BILLING_POLICY.maxTopupMicroRub,
    usageGrantRatioBps: Number(DEFAULT_BILLING_POLICY.topupProviderCostRatioBps),
    effectiveFrom: now,
    publishedAt: now,
    sourceKind: "BOOTSTRAP",
  };
}

async function replaceEntitlements(
  prisma: SeedFinanceClient,
  planVersionId: string,
  entitlements: PlanEntitlementRecord[],
): Promise<void> {
  const keys = entitlements.map((entitlement) => entitlement.key);
  await prisma.planEntitlement.deleteMany({
    where: {
      planVersionId,
      key: { notIn: keys },
    },
  });

  for (const entitlement of entitlements) {
    const encoded = encodeEntitlement(entitlement.value);
    const values = {
      valueKind: encoded.valueKind,
      unlimited: encoded.unlimited,
      intValue: encoded.intValue,
      boolValue: encoded.boolValue,
    };
    await prisma.planEntitlement.upsert({
      where: {
        planVersionId_key: {
          planVersionId,
          key: entitlement.key,
        },
      },
      update: values,
      create: {
        planVersionId,
        key: entitlement.key,
        ...values,
      },
    });
  }
}
