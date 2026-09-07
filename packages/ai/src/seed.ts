import { createPrismaClient } from "@vimla/database";
import { seedVimlaAiModels } from "./seed-models.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for seeding");
}

const prisma = createPrismaClient(databaseUrl);

try {
  await seedVimlaAiModels(prisma);
} finally {
  await prisma.$disconnect();
}
