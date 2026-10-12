import type { Prisma } from "@vimla/database";

/**
 * Transaction-scoped per-user guard for the Direct crypto-device roster.
 *
 * A row lock on existing devices cannot prevent a brand-new device INSERT.
 * Every Direct message fan-out transaction and every device enrolment or
 * revocation must acquire the same advisory lock before inspecting/mutating
 * active roster membership. Direct sends take SHARE advisory locks;
 * registration/revocation take exclusive locks. Concurrent sends, including
 * to different peers of a popular user, do NOT serialize on a per-user mutex.
 * Lock multiple users in lexical order to avoid cross-send deadlocks.
 */
export async function lockDirectDeviceRoster(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  userIds: readonly string[],
  mode: "shared" | "exclusive",
): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    const lockKey = `vimla:direct:device-roster:v1:${userId}`;
    if (mode === "shared") {
      await tx.$queryRaw<Array<{ locked: number }>>`
        WITH "direct_roster_lock" AS (
          SELECT pg_advisory_xact_lock_shared(hashtextextended(${lockKey}, 0))
        )
        SELECT 1::int AS "locked" FROM "direct_roster_lock"
      `;
    } else {
      await tx.$queryRaw<Array<{ locked: number }>>`
        WITH "direct_roster_lock" AS (
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        )
        SELECT 1::int AS "locked" FROM "direct_roster_lock"
      `;
    }
  }
}
