import { describe, expect, it } from "vitest";
import { createPrismaClient, pingDatabase } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start PostgreSQL and run `pnpm test:integration`.",
  );
}

describe("Prisma persistence", () => {
  it("connects and sees Better Auth tables", async () => {
    const client = createPrismaClient(testDatabaseUrl);

    try {
      await pingDatabase(client);
      const tables = await client.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      `;
      const names = tables.map((table) => table.tablename);

      expect(names).toEqual(
        expect.arrayContaining([
          "user",
          "session",
          "account",
          "verification",
          "plan",
          "plan_version",
          "subscription",
          "payment",
          "payment_event",
          "usage_bucket",
          "usage_reservation",
          "usage_reservation_allocation",
          "usage_ledger_entry",
          "ai_model",
          "ai_model_price_version",
          "conversation",
          "message",
          "ai_request",
          "workspace_object",
          "user_notification",
          "notification_delivery",
        ]),
      );
    } finally {
      await client.$disconnect();
    }
  });
});
