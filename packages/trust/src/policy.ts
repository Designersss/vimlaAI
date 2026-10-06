import { Prisma, type PrismaClient } from "@vimla/database";

export type TrustPolicyDb = Pick<
  PrismaClient,
  "$queryRaw" | "handle" | "userBlock"
>;

export interface UserTrustPolicy {
  canDiscover(actorUserId: string, targetUserId: string): Promise<boolean>;
  filterDiscoverableUserIds(
    actorUserId: string,
    candidateUserIds: readonly string[],
  ): Promise<readonly string[]>;
  hasBlocked(blockerUserId: string, blockedUserId: string): Promise<boolean>;
  canInteract(leftUserId: string, rightUserId: string): Promise<boolean>;
}

export function trustDiscoveryAllowedSql(
  actorUserId: string,
  candidateUserId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM "user_block" AS trust_block
      WHERE
        (
          trust_block."blockerUserId" = ${actorUserId}
          AND trust_block."blockedUserId" = ${candidateUserId}
        )
        OR (
          trust_block."blockedUserId" = ${actorUserId}
          AND trust_block."blockerUserId" = ${candidateUserId}
        )
    )
  `;
}

export async function lockTrustUserPair(
  db: TrustPolicyDb,
  leftUserId: string,
  rightUserId: string,
): Promise<boolean> {
  const userIds = [...new Set([leftUserId, rightUserId])].sort();
  if (userIds.length <= 1) {
    return true;
  }

  // Serialize only this unordered user pair. Locking the user rows themselves
  // would turn every Direct Chat write for a popular user into one global
  // per-user mutex across unrelated peers.
  const lockKey = JSON.stringify([
    "vimla-trust-user-pair-v1",
    userIds[0],
    userIds[1],
  ]);
  await db.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    WITH "trust_pair_lock" AS (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${lockKey}, 0)
      )
    )
    SELECT 1::int AS "locked"
    FROM "trust_pair_lock"
  `);

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "user"
    WHERE "id" IN (${Prisma.join(userIds)})
  `);
  return rows.length === userIds.length;
}

export class PrismaUserTrustPolicy implements UserTrustPolicy {
  constructor(private readonly db: TrustPolicyDb) {}

  canDiscover(
    actorUserId: string,
    targetUserId: string,
  ): Promise<boolean> {
    return this.canInteract(actorUserId, targetUserId);
  }

  async filterDiscoverableUserIds(
    actorUserId: string,
    candidateUserIds: readonly string[],
  ): Promise<readonly string[]> {
    const unique = [...new Set(candidateUserIds)];
    const peers = unique.filter(
      (userId) => userId !== actorUserId,
    );
    if (peers.length === 0) {
      return unique;
    }

    const rows = await this.db.userBlock.findMany({
      where: {
        OR: [
          {
            blockerUserId: actorUserId,
            blockedUserId: { in: peers },
          },
          {
            blockedUserId: actorUserId,
            blockerUserId: { in: peers },
          },
        ],
      },
      select: {
        blockerUserId: true,
        blockedUserId: true,
      },
    });

    const excluded = new Set<string>();
    for (const row of rows) {
      excluded.add(
        row.blockerUserId === actorUserId
          ? row.blockedUserId
          : row.blockerUserId,
      );
    }
    return unique.filter(
      (userId) =>
        userId === actorUserId || !excluded.has(userId),
    );
  }

  async hasBlocked(
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<boolean> {
    if (blockerUserId === blockedUserId) {
      return false;
    }
    const block = await this.db.userBlock.findFirst({
      where: {
        blockerUserId,
        blockedUserId,
      },
      select: { id: true },
    });
    return block !== null;
  }

  async canInteract(
    leftUserId: string,
    rightUserId: string,
  ): Promise<boolean> {
    if (leftUserId === rightUserId) {
      return true;
    }
    const block = await this.db.userBlock.findFirst({
      where: {
        OR: [
          {
            blockerUserId: leftUserId,
            blockedUserId: rightUserId,
          },
          {
            blockerUserId: rightUserId,
            blockedUserId: leftUserId,
          },
        ],
      },
      select: { id: true },
    });
    return block === null;
  }
}
