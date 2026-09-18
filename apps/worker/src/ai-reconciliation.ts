import { AiRequestReconciler } from "@vimla/ai";
import type { BillingEngine, BillingLogger } from "@vimla/billing";
import type { PrismaClient } from "@vimla/database";

export function createAiReconciler(
  prisma: PrismaClient,
  billingEngine: BillingEngine,
  logger: BillingLogger,
): AiRequestReconciler {
  return new AiRequestReconciler(prisma, billingEngine, logger);
}
