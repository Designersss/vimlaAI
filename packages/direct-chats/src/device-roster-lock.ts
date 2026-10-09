import type { Prisma } from "@vimla/database";

/**
 * Transaction-scoped per-user guard for the Direct crypto-device roster.
 *
 * A row lock on existing devices cannot prevent a brand-new device INSERT.
 * Every Direct message fan-out transaction and every device enrolment or
 * revocation must acquire the same advisory lock before inspecting/mutating
 * active roster membership. Lock multiple users in lexical order to avoid
 * opposite-direction Direct send deadlocks.
 *
 * This is a per-user lock, not a global mutex: unrelated conversations can
 * proceed concurrently when they have no participant in common.
 */
export async function lockDirectDeviceRoster(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    const lockKey = `vimla:direct:device-roster:v1:${userId}`;
    await tx.$queryRaw<Array<{ locked: number }>>`
      WITH "direct_roster_lock" AS (
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      )
      SELECT 1::int AS "locked" FROM "direct_roster_lock"
    `;
  }
}
