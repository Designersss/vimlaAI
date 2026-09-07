import { createPrismaClient } from "@vimla/database";
import { seedVimlaPlans } from "./seed-plans.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for seeding");
}

const prisma = createPrismaClient(databaseUrl);

try {
  await seedVimlaPlans(prisma);
} finally {
  await prisma.$disconnect();
}
