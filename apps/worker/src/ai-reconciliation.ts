import { AiRequestReconciler } from "@vimla/ai";
import { BillingEngine, type BillingLogger, type BillingPolicy } from "@vimla/billing";
import type { WorkerConfig } from "@vimla/config";
import type { PrismaClient } from "@vimla/database";

export function createAiReconciler(
  prisma: PrismaClient,
  config: WorkerConfig,
  logger: BillingLogger,
): AiRequestReconciler {
  const policy: BillingPolicy = {
    minTopupMicroRub: BigInt(config.billingMinTopupMicroRub),
    maxTopupMicroRub: BigInt(config.billingMaxTopupMicroRub),
    topupProviderCostRatioBps: BigInt(config.billingTopupRatioBps),
    subscriptionPeriodDays: config.billingSubscriptionPeriodDays,
  };
  return new AiRequestReconciler(prisma, new BillingEngine(prisma, policy, logger), logger);
}
