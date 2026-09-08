import type { PrismaClient } from "@vimla/database";
import { VIMLA_PLAN_CATALOG } from "./plan-catalog.js";
import { seedFinanceFoundation } from "./seed-finance.js";

export async function seedVimlaPlans(prisma: PrismaClient): Promise<void> {
  const now = new Date();

  for (const entry of VIMLA_PLAN_CATALOG) {
    const plan = await prisma.plan.upsert({
      where: { code: entry.code },
      update: { name: entry.name, active: true },
      create: { code: entry.code, name: entry.name, active: true },
    });

    const current = await prisma.planVersion.findFirst({
      where: {
        planId: plan.id,
        priceMicroRub: entry.priceMicroRub,
        providerBudgetMicroRub: entry.providerBudgetMicroRub,
        providerCostRatioBps: entry.providerCostRatioBps,
        status: "PUBLISHED",
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      orderBy: { validFrom: "desc" },
    });

    if (!current) {
      await prisma.planVersion.create({
        data: {
          planId: plan.id,
          priceMicroRub: entry.priceMicroRub,
          providerBudgetMicroRub: entry.providerBudgetMicroRub,
          providerCostRatioBps: entry.providerCostRatioBps,
          subscriptionPeriodDays: 30,
          status: "PUBLISHED",
          publishedAt: now,
          validFrom: now,
          validTo: null,
        },
      });
    }
  }

  await seedFinanceFoundation(prisma, now);
}
