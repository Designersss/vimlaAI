import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { BillingEngine } from "./billing-engine.js";
import { DEFAULT_BILLING_POLICY } from "./policy.js";
import { PaymentService } from "./payment-service.js";
import { PaymentMetrics } from "./payment-metrics.js";
import { seedVimlaPlans } from "./seed-plans.js";
import { republishBootstrapTopupPolicy } from "./seed-finance.js";
import { rubToMicroRub } from "./money.js";
import { signTBankToken } from "./tbank-token.js";
import { MockTBankTransport, TBankPaymentProvider } from "./tbank-provider.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const password = "test-tbank-password";
const terminalKey = "TestTerminalKey";

describe("hosted checkout and fulfillment", () => {
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

  it("calls Init at most once for a concurrent idempotency key", async () => {
    const userId = await createUser(prisma, "idem");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
    const idempotencyKey = randomUUID();

    const [first, second] = await Promise.all([
      service.checkoutSubscription({
        userId,
        planCode: "PRO",
        idempotencyKey,
        locale: "ru",
      }),
      service.checkoutSubscription({
        userId,
        planCode: "PRO",
        idempotencyKey,
        locale: "ru",
      }),
    ]);

    expect(first.paymentId).toBe(second.paymentId);
    expect(transport.inits).toHaveLength(1);
  });

  it("grants exactly once for a verified CONFIRMED notification and 100 duplicates", async () => {
    const userId = await createUser(prisma, "grant");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
    const checkout = await service.checkoutSubscription({
      userId,
      planCode: "PRO",
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    const payload = signedNotification({
      orderId: payment.providerOrderId,
      paymentId: payment.providerPaymentId ?? "missing",
      amount: 99000,
      status: "CONFIRMED",
    });

    const first = await service.handleProviderNotification(payload);
    expect(first.duplicate).toBe(false);
    for (let index = 0; index < 100; index += 1) {
      const replay = await service.handleProviderNotification(payload);
      expect(replay.duplicate).toBe(true);
    }

    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);
    const bucket = await prisma.usageBucket.findFirstOrThrow({ where: { userId } });
    expect(bucket.totalMicroRub).toBe(rubToMicroRub(297n));
  });

  it("does not grant on AUTHORIZED or amount mismatch", async () => {
    const userId = await createUser(prisma, "authz");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
    const checkout = await service.checkoutSubscription({
      userId,
      planCode: "PRO",
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 99000,
        status: "AUTHORIZED",
      }),
    );
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(0);

    const mismatch = await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 1,
        status: "CONFIRMED",
      }),
    );
    expect(mismatch.duplicate).toBe(false);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    expect(after.status).toBe("RECONCILIATION_REQUIRED");
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(0);
  });

  it("does not regress SUCCEEDED when a late AUTHORIZED notification arrives", async () => {
    const userId = await createUser(prisma, "ooo");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
    const checkout = await service.checkoutTopup({
      userId,
      amountMicroRub: rubToMicroRub(1000n),
      idempotencyKey: randomUUID(),
      locale: "en",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "NEW",
      }),
    );
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "CONFIRMED",
      }),
    );
    await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "AUTHORIZED",
      }),
    );
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    expect(after.status).toBe("SUCCEEDED");
    expect(after.providerStatus).toBe("CONFIRMED");
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);
  });

  it("fulfills a lost webhook through GetState CONFIRMED exactly once", async () => {
    const userId = await createUser(prisma, "recon");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
    const checkout = await service.checkoutTopup({
      userId,
      amountMicroRub: rubToMicroRub(1000n),
      idempotencyKey: randomUUID(),
      locale: "ru",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.paymentId } });
    transport.setStatus(payment.providerOrderId, "CONFIRMED");
    await prisma.payment.update({
      where: { id: payment.id },
      data: { updatedAt: new Date(Date.now() - 5 * 60_000) },
    });
    const fulfilled = await service.reconcilePending(new Date(), 50);
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);
    const again = await service.handleProviderNotification(
      signedNotification({
        orderId: payment.providerOrderId,
        paymentId: payment.providerPaymentId ?? "missing",
        amount: 100000,
        status: "CONFIRMED",
      }),
    );
    expect(again.duplicate || again.ok).toBe(true);
    expect(await prisma.usageBucket.count({ where: { userId } })).toBe(1);
  });

  it("refunds unused top-up grant without a negative bucket", async () => {
    const userId = await createUser(prisma, "refund");
    const transport = new MockTBankTransport();
    const service = paymentService(engine, transport);
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
    await engine.reserveUsage({
      userId,
      requestId: randomUUID(),
      estimatedProviderCostMicroRub: rubToMicroRub(100n),
    });
    const result = await service.refundOwnedPayment({ userId, paymentId: checkout.paymentId });
    expect(result.status === "REFUNDED" || result.status === "RECONCILIATION_REQUIRED").toBe(true);
    const bucket = await prisma.usageBucket.findFirstOrThrow({ where: { userId } });
    expect(bucket.totalMicroRub).toBeGreaterThanOrEqual(bucket.spentMicroRub + bucket.reservedMicroRub);
    expect(await prisma.usageLedgerEntry.count({ where: { userId, type: "BUCKET_REVOKED" } })).toBe(1);
  });
});

function paymentService(engine: BillingEngine, transport: MockTBankTransport): PaymentService {
  const tbank = new TBankPaymentProvider(
    {
      terminalKey,
      password,
      apiBaseUrl: "https://rest-api-test.tinkoff.ru",
      fiscalization: { enabled: false },
    },
    transport,
  );
  return new PaymentService(
    engine,
    tbank,
    {
      notificationUrl: "https://api.example/webhooks/tbank/payments",
      successUrl: "https://app.example/payment/result",
      failUrl: "https://app.example/payment/result",
    },
    { terminalKey, password },
    {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    new PaymentMetrics(),
  );
}

function signedNotification(input: {
  orderId: string;
  paymentId: string;
  amount: number;
  status: string;
}): Record<string, unknown> {
  const fields = {
    TerminalKey: terminalKey,
    OrderId: input.orderId,
    Success: true,
    Status: input.status,
    PaymentId: input.paymentId,
    ErrorCode: "0",
    Amount: input.amount,
  };
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
