import type { PrismaClient } from "@vimla/database";

export interface UserTrustPolicy {
  excludedDiscoveryUserIds(actorUserId: string): Promise<readonly string[]>;
  canInteract(leftUserId: string, rightUserId: string): Promise<boolean>;
}

export class PrismaUserTrustPolicy implements UserTrustPolicy {
  constructor(private readonly db: PrismaClient) {}

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
