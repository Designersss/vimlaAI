import { Prisma, type PrismaClient } from "@vimla/database";
import { VIMLA_PLAN_CATALOG } from "./plan-catalog.js";
import { seedFinanceFoundation } from "./seed-finance.js";

export async function seedVimlaPlans(prisma: PrismaClient): Promise<void> {
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('vimla:seed-plans:v1'))`,
      );

      for (const entry of VIMLA_PLAN_CATALOG) {
        const plan = await tx.plan.upsert({
          where: { code: entry.code },
          update: { name: entry.name, active: true },
          create: { code: entry.code, name: entry.name, active: true },
        });

        const current = await tx.planVersion.findFirst({
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
          await tx.planVersion.create({
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

      await seedFinanceFoundation(tx, now);
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}
