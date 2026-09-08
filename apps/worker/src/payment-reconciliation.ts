import {
  BillingEngine,
  MockPaymentProvider,
  PaymentMetrics,
  PaymentService,
  TBankHttpTransport,
  TBankPaymentProvider,
  isDevBillingEnvironment,
  type BillingLogger,
  type BillingPolicy,
} from "@vimla/billing";
import type { WorkerConfig } from "@vimla/config";
import type { PrismaClient } from "@vimla/database";

export function createWorkerPaymentService(
  prisma: PrismaClient,
  config: WorkerConfig,
  logger: BillingLogger,
): PaymentService {
  const policy: BillingPolicy = {
    minTopupMicroRub: BigInt(config.billingMinTopupMicroRub),
    maxTopupMicroRub: BigInt(config.billingMaxTopupMicroRub),
    topupProviderCostRatioBps: BigInt(config.billingTopupRatioBps),
    subscriptionPeriodDays: config.billingSubscriptionPeriodDays,
  };
  const engine = new BillingEngine(prisma, policy, logger);
  const provider =
    config.paymentProvider === "tbank"
      ? new TBankPaymentProvider(
          {
            terminalKey: config.tbankTerminalKey,
            password: config.tbankPassword,
            apiBaseUrl: config.tbankApiBaseUrl,
            fiscalization: { enabled: false },
          },
          new TBankHttpTransport(config.tbankApiBaseUrl),
        )
      : new MockPaymentProvider(isDevBillingEnvironment(config.appEnv));

  return new PaymentService(
    engine,
    provider,
    {
      notificationUrl: "http://127.0.0.1/webhooks/tbank/payments",
      successUrl: "http://127.0.0.1/payment/result",
      failUrl: "http://127.0.0.1/payment/result",
    },
    { terminalKey: config.tbankTerminalKey, password: config.tbankPassword },
    logger,
    new PaymentMetrics(),
  );
}
