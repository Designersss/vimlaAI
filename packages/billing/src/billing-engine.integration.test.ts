import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { BillingEngine } from "./billing-engine.js";
import { BillingError } from "./errors.js";
import { DEFAULT_BILLING_POLICY } from "./policy.js";
import { MOCK_PAYMENT_PROVIDER_ID, MockPaymentProvider } from "./payment-provider.js";
import { seedVimlaPlans } from "./seed-plans.js";
import { simulateProviderUsage } from "./simulate-provider-usage.js";
import { rubToMicroRub } from "./money.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start PostgreSQL and run `pnpm test:integration`.",
  );
}

describe("billing engine integration", () => {
  let prisma: PrismaClient;
  let engine: BillingEngine;

  beforeAll(async () => {
    prisma = createPrismaClient(testDatabaseUrl);
    engine = new BillingEngine(prisma, DEFAULT_BILLING_POLICY);
    await seedVimlaPlans(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("grants Pro monthly usage from a succeeded payment once", async () => {
    const userId = await createUser(prisma, "pro");
    const payment = await purchaseSubscription(engine, userId, "PRO");
    const duplicate = await engine.processPaymentEvent(payment.event);

    expect(duplicate.duplicate).toBe(true);

    for (let index = 0; index < 8; index += 1) {
      const replay = await engine.processPaymentEvent(payment.event);
      expect(replay.duplicate).toBe(true);
    }

    const bucket = await prisma.usageBucket.findFirstOrThrow({
      where: { userId, type: "MONTHLY" },
    });
    expect(bucket.totalMicroRub).toBe(rubToMicroRub(297n));
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);

    const granted = await prisma.usageLedgerEntry.aggregate({
      where: { userId, type: "BUCKET_GRANTED" },
      _sum: { amountMicroRub: true },
    });
    expect(granted._sum.amountMicroRub).toBe(rubToMicroRub(297n));
  });

  it("calculates top-up provider budget with integer arithmetic", async () => {
    const userId = await createUser(prisma, "topup");
    await purchaseTopup(engine, userId, rubToMicroRub(1000n));
    const bucket = await prisma.usageBucket.findFirstOrThrow({
      where: { userId, type: "TOPUP" },
    });
    expect(bucket.totalMicroRub).toBe(rubToMicroRub(350n));
    expect(bucket.expiresAt).toBeNull();
  });

  it("reserves, settles, and releases usage against a monthly bucket", async () => {
    const userId = await createUser(prisma, "cycle");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(100n), future());

    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(30n),
    });
    expect(reserved.status).toBe("ACTIVE");
    await expectSnapshot(prisma, userId, { spent: 0n, reserved: 30n, remaining: 70n });

    await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: rubToMicroRub(10n),
    });
    await expectSnapshot(prisma, userId, { spent: 10n, reserved: 0n, remaining: 90n });
  });

  it("releases unused reservation after a simulated provider failure", async () => {
    const userId = await createUser(prisma, "release");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(100n), future());

    const released = await simulateProviderUsage(engine, {
      userId,
      requestId: randomUUID(),
      estimatedMicroRub: rubToMicroRub(30n),
      outcome: "failure",
    });
    expect(released.status).toBe("RELEASED");
    await expectSnapshot(prisma, userId, { spent: 0n, reserved: 0n, remaining: 100n });
  });

  it("settles simulated provider success at the actual cost", async () => {
    const userId = await createUser(prisma, "simok");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(100n), future());

    const settled = await simulateProviderUsage(engine, {
      userId,
      requestId: randomUUID(),
      estimatedMicroRub: rubToMicroRub(30n),
      actualMicroRub: rubToMicroRub(10n),
      outcome: "success",
    });
    expect(settled.status).toBe("SETTLED");
    await expectSnapshot(prisma, userId, { spent: 10n, reserved: 0n, remaining: 90n });
  });

  it("can release a reservation after the monthly bucket expires", async () => {
    const userId = await createUser(prisma, "late");
    const bucket = await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(100n), future());
    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(30n),
    });

    await prisma.usageBucket.update({
      where: { id: bucket.id },
      data: { expiresAt: new Date("2020-01-01") },
    });

    const released = await engine.releaseUsage({ userId, reservationId: reserved.id });
    expect(released.status).toBe("RELEASED");
    const after = await prisma.usageBucket.findUniqueOrThrow({ where: { id: bucket.id } });
    expect(after.reservedMicroRub).toBe(0n);
    expect(after.spentMicroRub).toBe(0n);
  });

  it("preserves 0.003217 RUB as 3217 microRUB", async () => {
    const userId = await createUser(prisma, "precision");
    await grantBucket(prisma, userId, "MONTHLY", 3217n, future());
    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: 3217n,
    });
    await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: 3217n,
    });
    const bucket = await prisma.usageBucket.findFirstOrThrow({ where: { userId } });
    expect(bucket.spentMicroRub).toBe(3217n);
    expect(bucket.reservedMicroRub).toBe(0n);
  });

  it("rejects updates to ledger history", async () => {
    const userId = await createUser(prisma, "ledger");
    await purchaseTopup(engine, userId, rubToMicroRub(1000n));
    const entry = await prisma.usageLedgerEntry.findFirstOrThrow({ where: { userId } });
    await expect(
      prisma.usageLedgerEntry.update({
        where: { id: entry.id },
        data: { amountMicroRub: 1n },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("allocates monthly before top-up", async () => {
    const userId = await createUser(prisma, "split");
    const monthly = await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(2n), future());
    const topup = await grantBucket(prisma, userId, "TOPUP", rubToMicroRub(10n), null);

    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(5n),
    });

    const monthlyAllocation = reserved.allocations.find((item) => item.bucketId === monthly.id);
    const topupAllocation = reserved.allocations.find((item) => item.bucketId === topup.id);
    expect(monthlyAllocation?.reservedMicroRub).toBe(rubToMicroRub(2n));
    expect(topupAllocation?.reservedMicroRub).toBe(rubToMicroRub(3n));
  });

  it("ignores expired monthly buckets", async () => {
    const userId = await createUser(prisma, "expired");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(50n), new Date("2020-01-01"));
    await grantBucket(prisma, userId, "TOPUP", rubToMicroRub(10n), null);

    await expect(
      engine.reserveUsage({
        userId,
        requestId: randomUUID(),
        estimatedProviderCostMicroRub: rubToMicroRub(20n),
      }),
    ).rejects.toBeInstanceOf(BillingError);

    const reserved = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(10n),
    });
    expect(reserved.allocations).toHaveLength(1);
  });

  it("does not double-settle or double-release", async () => {
    const userId = await createUser(prisma, "idem");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(40n), future());
    const requestId = randomUUID();
    const reserved = await engine.reserveUsage({
      userId,
      requestId,
      estimatedProviderCostMicroRub: rubToMicroRub(10n),
    });

    await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: rubToMicroRub(4n),
    });
    const again = await engine.settleUsage({
      userId,
      reservationId: reserved.id,
      actualMicroRub: rubToMicroRub(4n),
    });
    expect(again.status).toBe("SETTLED");
    await expectSnapshot(prisma, userId, { spent: 4n, reserved: 0n, remaining: 36n });

    await expect(
      engine.settleUsage({
        userId,
        reservationId: reserved.id,
        actualMicroRub: rubToMicroRub(7n),
      }),
    ).rejects.toMatchObject({ code: "RESERVATION_CONFLICT" });

    const other = await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(5n),
    });
    await engine.releaseUsage({ userId, reservationId: other.id });
    const releasedAgain = await engine.releaseUsage({ userId, reservationId: other.id });
    expect(releasedAgain.status).toBe("RELEASED");
    await expectSnapshot(prisma, userId, { spent: 4n, reserved: 0n, remaining: 36n });
  });

  it("rejects concurrent overspend", async () => {
    const userId = await createUser(prisma, "race");
    await grantBucket(prisma, userId, "MONTHLY", rubToMicroRub(5n), future());

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        engine.reserveUsage({
          userId,
          requestId: randomUUID(),
          estimatedProviderCostMicroRub: rubToMicroRub(4n),
        }),
      ),
    );

    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(99);
    expect(
      failed.every(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof BillingError &&
          (result.reason.code === "INSUFFICIENT_USAGE" ||
            result.reason.code === "FINANCIAL_OPERATION_FAILED"),
      ),
    ).toBe(true);

    const bucket = await prisma.usageBucket.findFirstOrThrow({ where: { userId } });
    expect(bucket.spentMicroRub + bucket.reservedMicroRub).toBeLessThanOrEqual(bucket.totalMicroRub);
    expect(bucket.reservedMicroRub).toBe(rubToMicroRub(4n));
  });

  it("does not grant twice when the same payment event is processed concurrently", async () => {
    const userId = await createUser(prisma, "payrace");
    const mock = new MockPaymentProvider(true);
    const created = mock.createPayment("TOPUP");
    await engine.createPendingPayment({
      userId,
      provider: MOCK_PAYMENT_PROVIDER_ID,
      providerPaymentId: created.providerPaymentId,
      kind: "TOPUP",
      amountMicroRub: rubToMicroRub(1000n),
    });
    const event = mock.succeed(created.providerPaymentId);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => engine.processPaymentEvent(event)),
    );
    const buckets = await prisma.usageBucket.count({ where: { userId } });
    expect(buckets).toBe(1);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  });

  it("rejects malformed and out-of-bounds top-ups", async () => {
    const userId = await createUser(prisma, "bounds");
    await expect(
      engine.createPendingPayment({
        userId,
        provider: MOCK_PAYMENT_PROVIDER_ID,
        providerPaymentId: randomUUID(),
        kind: "TOPUP",
        amountMicroRub: 0n,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOPUP_AMOUNT" });

    await expect(
      engine.createPendingPayment({
        userId,
        provider: MOCK_PAYMENT_PROVIDER_ID,
        providerPaymentId: randomUUID(),
        kind: "TOPUP",
        amountMicroRub: -100n,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOPUP_AMOUNT" });

    await expect(
      engine.createPendingPayment({
        userId,
        provider: MOCK_PAYMENT_PROVIDER_ID,
        providerPaymentId: randomUUID(),
        kind: "TOPUP",
        amountMicroRub: rubToMicroRub(1_000_000n),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOPUP_AMOUNT" });
  });
});

async function createUser(prisma: PrismaClient, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: label,
      email: `${label}-${randomUUID()}@example.com`,
      emailVerified: false,
    },
  });
  return user.id;
}

async function grantBucket(
  prisma: PrismaClient,
  userId: string,
  type: "MONTHLY" | "TOPUP",
  total: bigint,
  expiresAt: Date | null,
) {
  return prisma.usageBucket.create({
    data: {
      userId,
      type,
      totalMicroRub: total,
      spentMicroRub: 0n,
      reservedMicroRub: 0n,
      expiresAt,
      sourceType: "TEST",
      sourceId: randomUUID(),
    },
  });
}

async function purchaseSubscription(
  engine: BillingEngine,
  userId: string,
  code: "LITE" | "START" | "PRO",
) {
  const version = await engine.findCurrentPlanVersionByCode(code);
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
  const event = mock.succeed(created.providerPaymentId);
  await engine.processPaymentEvent(event);
  return { event };
}

async function purchaseTopup(
  engine: BillingEngine,
  userId: string,
  amount: bigint,
) {
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

async function expectSnapshot(
  prisma: PrismaClient,
  userId: string,
  expected: { spent: bigint; reserved: bigint; remaining: bigint },
): Promise<void> {
  const buckets = await prisma.usageBucket.findMany({ where: { userId } });
  const spent = buckets.reduce((sum, bucket) => sum + bucket.spentMicroRub, 0n);
  const reserved = buckets.reduce((sum, bucket) => sum + bucket.reservedMicroRub, 0n);
  const total = buckets.reduce((sum, bucket) => sum + bucket.totalMicroRub, 0n);
  expect(spent).toBe(rubToMicroRub(expected.spent));
  expect(reserved).toBe(rubToMicroRub(expected.reserved));
  expect(total - spent - reserved).toBe(rubToMicroRub(expected.remaining));
}

function future(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}
