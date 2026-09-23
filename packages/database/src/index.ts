import { PrismaClient } from "@prisma/client";

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

export async function pingDatabase(client: PrismaClient): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}

export { Prisma, PrismaClient } from "@prisma/client";

export type { SemanticSource } from "@prisma/client";
