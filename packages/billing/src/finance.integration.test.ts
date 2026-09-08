import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { BillingEngine } from "./billing-engine.js";
import { DEFAULT_BILLING_POLICY } from "./policy.js";
import { PaymentService } from "./payment-service.js";
import { PaymentMetrics } from "./payment-metrics.js";
import { seedVimlaPlans } from "./seed-plans.js";
import { rubToMicroRub } from "./money.js";
import { signTBankToken } from "./tbank-token.js";
import { MockTBankTransport, TBankPaymentProvider } from "./tbank-provider.js";
import { EffectivePlanResolver, FREE_PLAN_CODE } from "./effective-plan.js";
import { FinanceQueryService } from "./finance-query.js";
import { assertKnownEntitlementKey } from "./entitlements.js";
import { republishBootstrapTopupPolicy } from "./seed-finance.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const password = "test-tbank-password";
const terminalKey = "TestTerminalKey";

describe("finance and tariff foundation", () => {
  let prisma: PrismaClient;
  let engine: BillingEngine;

  beforeAll(async () => {
    prisma = createPrismaClient(testDatabaseUrl);
    engine = new BillingEngine(prisma, DEFAULT_BILLING_POLICY);
    await seedVimlaPlans(prisma);
    await republishBootstrapTopupPolicy(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses FREE as a fallback entitlement without a fake paid subscription", async () => {
    const userId = await createUser(prisma, "free");
    const effective = await new EffectivePlanResolver(prisma).resolve(userId);
    expect(effective.planCode).toBe(FREE_PLAN_CODE);
    expect(effective.source).toBe("FREE_FALLBACK");
    expect(effective.subscriptionId).toBeNull();
    expect(effective.monthlyUsageGrantMicroRub).toBe(0n);
    expect(effective.topupAllowed).toBe(true);
    expect(await prisma.subscription.count({ where: { userId } })).toBe(0);
  });

  it("lets a FREE user buy a non-expiring top-up", async () => {
    const userId = await createUser(prisma, "freetop");
    const service = paymentService(engine);
    const checkout = await service.checkoutTopup({
      userId,
      amountMicroRub: rubToMicroRub(1000n),
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "CONFIRMED",
      }),
    );
    const bucket = await prisma.usageBucket.findFirstOrThrow({
      where: { userId, type: "TOPUP" },
    });
    expect(bucket.expiresAt).toBeNull();
    expect(bucket.totalMicroRub).toBe(rubToMicroRub(350n));
  });

  it("keeps unspent top-up in outstanding obligation and excludes consumed usage", async () => {
    const userId = await createUser(prisma, "ob");
    await purchaseTopup(engine, userId, rubToMicroRub(1000n));
    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(50n),
    });
    await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: rubToMicroRub(50n),
    });
    const finance = new FinanceQueryService(prisma);
    const overview = await finance.overview({ userId });
    expect(overview.outstandingTopupUsageMicroRub).toBe(rubToMicroRub(300n));
    expect(overview.conservativeContributionMicroRub).toBe(
      overview.realizedContributionMicroRub - overview.totalOutstandingUsageMicroRub,
    );
    expect(overview.conservativeContributionMicroRub).not.toBe(
      overview.realizedContributionMicroRub - rubToMicroRub(350n),
    );
    const utilization = await finance.utilization({ userId, paymentKind: "TOPUP" });
    expect(utilization.remainingMicroRub + utilization.consumedMicroRub).toBe(utilization.grantMicroRub);
  });

  it("uses providerActualCostMicroRub as AI COGS and does not double-count split reservations", async () => {
    const userId = await createUser(prisma, "cogs");
    await purchaseSubscription(engine, userId);
    await purchaseTopup(engine, userId, rubToMicroRub(1000n));
    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(298n),
    });
    await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: rubToMicroRub(30n),
    });
    await createAiRequest(prisma, {
      userId,
      reservationId: reserved.id,
      providerActualCostMicroRub: rubToMicroRub(80n),
      userSettledUsageMicroRub: rubToMicroRub(30n),
    });
    const allocations = await prisma.usageReservationAllocation.count({
      where: { reservationId: reserved.id },
    });
    expect(allocations).toBeGreaterThan(1);
    const finance = new FinanceQueryService(prisma);
    const overview = await finance.overview({ userId });
    expect(overview.realizedAiCogsMicroRub).toBe(rubToMicroRub(80n));
    expect(overview.realizedAiCogsMicroRub).not.toBe(rubToMicroRub(30n));
    expect(overview.realizedAiCogsMicroRub).not.toBe(rubToMicroRub(80n) * BigInt(allocations));
  });

  it("drops expired monthly usage from outstanding obligation", async () => {
    const userId = await createUser(prisma, "exp");
    await purchaseSubscription(engine, userId);
    await prisma.usageBucket.updateMany({
      where: { userId, type: "MONTHLY" },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    const finance = new FinanceQueryService(prisma);
    const overview = await finance.overview({ userId });
    expect(overview.outstandingMonthlyUsageMicroRub).toBe(0n);
    expect(overview.expiredMonthlyUsageMicroRub).toBe(rubToMicroRub(297n));
  });

  it("does not rewrite historical checkout when a new top-up policy is published", async () => {
    const userId = await createUser(prisma, "histtop");
    const service = paymentService(engine);
    const checkout = await service.checkoutTopup({
      userId,
      amountMicroRub: rubToMicroRub(1000n),
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    const snapshot = before.checkoutSnapshot as { topupRatioBps: string; topupPolicyVersionId?: string };
    expect(snapshot.topupRatioBps).toBe("3500");
    try {
      await prisma.topupPolicyVersion.updateMany({
        where: { status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: new Date(), effectiveTo: new Date() },
      });
      await prisma.topupPolicyVersion.create({
        data: {
          status: "PUBLISHED",
          minPurchaseMicroRub: DEFAULT_BILLING_POLICY.minTopupMicroRub,
          maxPurchaseMicroRub: DEFAULT_BILLING_POLICY.maxTopupMicroRub,
          usageGrantRatioBps: 4000,
          effectiveFrom: new Date(),
          publishedAt: new Date(),
          sourceKind: "BOOTSTRAP",
        },
      });
      const after = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
      const afterSnapshot = after.checkoutSnapshot as { topupRatioBps: string };
      expect(afterSnapshot.topupRatioBps).toBe("3500");
    } finally {
      await republishBootstrapTopupPolicy(prisma);
    }
  });

  it("does not change a historical plan checkout when a new PlanVersion exists", async () => {
    const userId = await createUser(prisma, "histplan");
    const service = paymentService(engine);
    const checkout = await service.checkoutSubscription({
      userId,
      planCode: "PRO",
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    const originalVersion = payment.planVersionId;
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    await prisma.planVersion.create({
      data: {
        planId: plan.id,
        priceMicroRub: rubToMicroRub(249n),
        providerBudgetMicroRub: rubToMicroRub(50n),
        providerCostRatioBps: 2000,
        status: "DRAFT",
        validFrom: new Date(),
      },
    });
    const again = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    expect(again.planVersionId).toBe(originalVersion);
    expect(again.amountMicroRub).toBe(rubToMicroRub(990n));
  });

  it("keeps historical fee estimates when a new fee policy is published", async () => {
    const userId = await createUser(prisma, "feepol");
    await prisma.paymentFeePolicyVersion.updateMany({
      where: { provider: "tbank", paymentMethod: "CARD", status: "PUBLISHED" },
      data: { status: "RETIRED", retiredAt: new Date(), effectiveTo: new Date() },
    });
    const firstPolicy = await prisma.paymentFeePolicyVersion.create({
      data: {
        provider: "tbank",
        paymentMethod: "CARD",
        feeBps: 1000,
        feeVatBps: 0,
        status: "PUBLISHED",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        publishedAt: new Date("2020-01-01T00:00:00.000Z"),
        sourceDescription: "test estimate only",
        sourceQuality: "ESTIMATE",
      },
    });
    const service = paymentService(engine);
    const checkout = await service.checkoutSubscription({
      userId,
      planCode: "LITE",
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 15000,
        status: "CONFIRMED",
        pan: "2200******1111",
      }),
    );
    const economics = await prisma.paymentEconomics.findUniqueOrThrow({
      where: { paymentId: checkout.paymentId },
    });
    expect(economics.paymentFeePolicyVersionId).toBe(firstPolicy.id);
    const originalEstimate = economics.estimatedAcquiringFeeMicroRub;
    await prisma.paymentFeePolicyVersion.create({
      data: {
        provider: "tbank",
        paymentMethod: "CARD",
        feeBps: 5000,
        feeVatBps: 0,
        status: "PUBLISHED",
        effectiveFrom: new Date(),
        publishedAt: new Date(),
        sourceDescription: "later estimate",
        sourceQuality: "ESTIMATE",
      },
    });
    const unchanged = await prisma.paymentEconomics.findUniqueOrThrow({
      where: { paymentId: checkout.paymentId },
    });
    expect(unchanged.estimatedAcquiringFeeMicroRub).toBe(originalEstimate);
    expect(unchanged.paymentFeePolicyVersionId).toBe(firstPolicy.id);
  });

  it("uses actual fees instead of adding them to estimates and reduces net sales on refund", async () => {
    const userId = await createUser(prisma, "actual");
    const service = paymentService(engine);
    const checkout = await service.checkoutTopup({
      userId,
      amountMicroRub: rubToMicroRub(1000n),
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "CONFIRMED",
      }),
    );
    await prisma.paymentEconomics.upsert({
      where: { paymentId: checkout.paymentId },
      update: {
        estimatedAcquiringFeeMicroRub: rubToMicroRub(10n),
        actualAcquiringFeeMicroRub: rubToMicroRub(7n),
        estimatedAcquiringFeeVatMicroRub: 0n,
        actualAcquiringFeeVatMicroRub: 0n,
        economicsStatus: "PARTIAL",
      },
      create: {
        paymentId: checkout.paymentId,
        grossAmountMicroRub: rubToMicroRub(1000n),
        estimatedAcquiringFeeMicroRub: rubToMicroRub(10n),
        actualAcquiringFeeMicroRub: rubToMicroRub(7n),
        economicsStatus: "PARTIAL",
      },
    });
    const finance = new FinanceQueryService(prisma);
    const before = await finance.overview({ paymentKind: "TOPUP", userId });
    expect(before.usedPaymentFeesMicroRub).toBe(before.actualPaymentFeesMicroRub);
    expect(before.usedPaymentFeesMicroRub).not.toBe(
      before.actualPaymentFeesMicroRub + before.estimatedPaymentFeesMicroRub,
    );
    await service.refundOwnedPayment({ userId, paymentId: checkout.paymentId });
    const after = await finance.overview({ paymentKind: "TOPUP", userId });
    expect(after.netSalesMicroRub).toBe(after.grossRevenueMicroRub - after.refundsMicroRub);
  });

  it("does not revoke a successful grant when no fee policy exists", async () => {
    const userId = await createUser(prisma, "nopolicy");
    const service = paymentService(engine);
    const checkout = await service.checkoutSubscription({
      userId,
      planCode: "START",
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 30000,
        status: "CONFIRMED",
      }),
    );
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    expect(paid.status).toBe("SUCCEEDED");
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);
    const economics = await prisma.paymentEconomics.findUnique({
      where: { paymentId: checkout.paymentId },
    });
    expect(economics?.economicsStatus).toBe("RECONCILIATION_REQUIRED");
  });

  it("rejects unknown entitlement keys and published commercial updates", async () => {
    expect(() => assertKnownEntitlementKey("not.a.key")).toThrow();
    const pro = await prisma.planVersion.findFirstOrThrow({
      where: { status: "PUBLISHED", plan: { code: "PRO" } },
    });
    await expect(
      prisma.planVersion.update({
        where: { id: pro.id },
        data: { priceMicroRub: rubToMicroRub(1n) },
      }),
    ).rejects.toThrow(/immutable/i);
  });
});

function paymentService(engine: BillingEngine): PaymentService {
  return new PaymentService(
    engine,
    new TBankPaymentProvider(
      {
        terminalKey,
        password,
        apiBaseUrl: "https://rest-api-test.tinkoff.ru",
        fiscalization: { enabled: false },
      },
      new MockTBankTransport(),
    ),
    {
      notificationUrl: "https://api.example/webhooks/tbank/payments",
      successUrl: "https://app.example/payment/result",
      failUrl: "https://app.example/payment/result",
    },
    { terminalKey, password },
    { info: () => undefined, warn: () => undefined, error: () => undefined },
    new PaymentMetrics(),
  );
}

function signedNotification(input: {
  orderId: string;
  paymentId: string;
  amount: number;
  status: string;
  pan?: string;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    TerminalKey: terminalKey,
    OrderId: input.orderId,
    Success: true,
    Status: input.status,
    PaymentId: input.paymentId,
    ErrorCode: "0",
    Amount: input.amount,
  };
  if (input.pan) {
    fields.Pan = input.pan;
  }
  return { ...fields, Token: signTBankToken(fields, password) };
}

async function createUser(prisma: PrismaClient, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: label,
      email: `${label}-${randomUUID()}@example.com`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function purchaseSubscription(engine: BillingEngine, userId: string) {
  const version = await engine.findCurrentPlanVersionByCode("PRO");
  const { MockPaymentProvider, MOCK_PAYMENT_PROVIDER_ID } = await import("./payment-provider.js");
  const mock = new MockPaymentProvider(true);
  const created = mock.createPayment("SUBSCRIPTION");
  await engine.createPendingPayment({
    userId,
    provider: MOCK_PAYMENT_PROVIDER_ID,
    providerPaymentId: created.providerPaymentId,
    kind: "SUBSCRIPTION",
    amountMicroRub: version.priceMicroRub,
    planVersionId: version.planVersionId,
  });
  await engine.processPaymentEvent(mock.succeed(created.providerPaymentId));
}

async function createAiRequest(
  prisma: PrismaClient,
  input: {
    userId: string;
    reservationId: string;
    providerActualCostMicroRub: bigint;
    userSettledUsageMicroRub: bigint;
  },
): Promise<void> {
  const model = await prisma.aiModel.create({
    data: {
      slug: `finance-cogs-${randomUUID()}`,
      displayName: "Finance COGS fixture",
      vendor: "test",
      provider: "mock",
      providerModelId: "mock/cogs",
      contextWindowTokens: 128,
      maxOutputTokens: 32,
    },
  });
  const price = await prisma.aiModelPriceVersion.create({
    data: {
      modelId: model.id,
      inputMicroRubPerMillion: 1n,
      outputMicroRubPerMillion: 1n,
      effectiveFrom: new Date(),
      verifiedAt: new Date(),
      source: "test",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: input.userId, title: "cogs" },
  });
  await prisma.aiRequest.create({
    data: {
      userId: input.userId,
      conversationId: conversation.id,
      modelId: model.id,
      priceVersionId: price.id,
      reservationId: input.reservationId,
      clientRequestId: randomUUID(),
      provider: "mock",
      providerModelId: "mock/cogs",
      status: "SUCCEEDED",
      financialStatus: "SETTLED",
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      estimatedCostMicroRub: input.userSettledUsageMicroRub,
      providerActualCostMicroRub: input.providerActualCostMicroRub,
      userSettledUsageMicroRub: input.userSettledUsageMicroRub,
    },
  });
}

async function purchaseTopup(engine: BillingEngine, userId: string, amount: bigint) {
  const { MockPaymentProvider, MOCK_PAYMENT_PROVIDER_ID } = await import("./payment-provider.js");
  const mock = new MockPaymentProvider(true);
  const created = mock.createPayment("TOPUP");
  await engine.createPendingPayment({
    userId,
    provider: MOCK_PAYMENT_PROVIDER_ID,
    providerPaymentId: created.providerPaymentId,
    kind: "TOPUP",
    amountMicroRub: amount,
  });
  await engine.processPaymentEvent(mock.succeed(created.providerPaymentId));
}
