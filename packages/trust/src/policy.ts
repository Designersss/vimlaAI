import { Prisma, type PrismaClient } from "@vimla/database";

export type TrustPolicyDb = Pick<
  PrismaClient,
  "$queryRaw" | "handle" | "userBlock"
>;

export interface UserTrustPolicy {
  excludedDiscoveryUserIds(actorUserId: string): Promise<readonly string[]>;
  canInteract(leftUserId: string, rightUserId: string): Promise<boolean>;
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

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "user"
    WHERE "id" IN (${Prisma.join(userIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  return rows.length === userIds.length;
}

export class PrismaUserTrustPolicy implements UserTrustPolicy {
  constructor(private readonly db: TrustPolicyDb) {}

  async excludedDiscoveryUserIds(
    actorUserId: string,
  ): Promise<readonly string[]> {
    const rows = await this.db.userBlock.findMany({
      where: {
        OR: [
          { blockerUserId: actorUserId },
          { blockedUserId: actorUserId },
        ],
      },
      select: {
        blockerUserId: true,
        blockedUserId: true,
      },
    });

    const excluded = new Set<string>();
    for (const row of rows) {
      if (row.blockerUserId !== actorUserId) {
        excluded.add(row.blockerUserId);
      }
      if (row.blockedUserId !== actorUserId) {
        excluded.add(row.blockedUserId);
      }
    }
    return [...excluded];
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
