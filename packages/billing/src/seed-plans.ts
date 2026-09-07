import type { PrismaClient } from "@vimla/database";
import { VIMLA_PLAN_CATALOG } from "./plan-catalog.js";

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
          validFrom: now,
          validTo: null,
        },
      });
    }
  }
}
