import { Inject, Injectable } from "@nestjs/common";
import { handleInputSchema } from "@vimla/contracts";
import {
  PUBLIC_PROFILE_LIMITS,
  publicProfileSchema,
  type PublicProfile,
  type UpdatePublicProfile,
} from "@vimla/contracts/public-profiles";
import { Prisma } from "@vimla/database";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  PEOPLE_ACCESS_POLICY,
  type PeopleAccessPolicy,
} from "./people-access-policy.js";

type PublicProfileRow = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  status: string | null;
};

@Injectable()
export class PeopleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PEOPLE_ACCESS_POLICY) private readonly accessPolicy: PeopleAccessPolicy,
  ) {}

  async getByHandle(actorUserId: string, handleInput: string): Promise<PublicProfile | null> {
    const handle = handleInputSchema.parse(handleInput);
    const rows = await this.prisma.client.$queryRaw<PublicProfileRow[]>(Prisma.sql`
      SELECT
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl",
        profile."bio" AS "bio",
        profile."status" AS "status"
      FROM "public_profile" AS profile
      JOIN "handle" AS handle ON handle."id" = profile."handleId"
      WHERE
        handle."normalized" = ${handle}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const excluded = new Set(
      await this.accessPolicy.excludedDiscoveryUserIds(actorUserId),
    );
    if (excluded.has(row.userId)) {
      return null;
    }
    return toPublicProfile(row);
  }

  async search(actorUserId: string, query: string, limit: number): Promise<PublicProfile[]> {
    const trimmed = query.trim();
    const handleOnly = trimmed.startsWith("@");
    const identityQuery = handleOnly ? trimmed.slice(1).trim() : trimmed;
    const handleQuery = identityQuery.toLowerCase();
    const identityLength = Array.from(identityQuery).length;
    const prefixSearch =
      identityLength >=
      PUBLIC_PROFILE_LIMITS.searchPrefixMatchMin;
    const containsSearch =
      identityLength >=
      PUBLIC_PROFILE_LIMITS.searchContainsMatchMin;
    const handlePrefixPattern = `${escapeLikePattern(handleQuery)}%`;
    const displayPrefixPattern = `${escapeLikePattern(trimmed.toLowerCase())}%`;
    const handleContainsPattern = `%${escapeLikePattern(handleQuery)}%`;
    const displayContainsPattern = `%${escapeLikePattern(trimmed)}%`;
    const searchPredicate = containsSearch
      ? handleOnly
        ? Prisma.sql`handle."normalized" LIKE ${handleContainsPattern}`
        : Prisma.sql`(
            handle."normalized" LIKE ${handleContainsPattern}
            OR profile."displayName" ILIKE ${displayContainsPattern}
          )`
      : prefixSearch
        ? handleOnly
          ? Prisma.sql`handle."normalized" LIKE ${handlePrefixPattern}`
          : Prisma.sql`(
              handle."normalized" LIKE ${handlePrefixPattern}
              OR lower(profile."displayName") LIKE ${displayPrefixPattern}
            )`
        : handleOnly
          ? Prisma.sql`handle."normalized" = ${handleQuery}`
          : Prisma.sql`(
              handle."normalized" = ${handleQuery}
              OR lower(profile."displayName") = lower(${trimmed})
            )`;
    const excludedUserIds = [
      ...new Set(
        await this.accessPolicy.excludedDiscoveryUserIds(actorUserId),
      ),
    ];
    const discoveryPredicate = excludedUserIds.length === 0
      ? Prisma.sql`TRUE`
      : Prisma.sql`profile."userId" NOT IN (${Prisma.join(excludedUserIds)})`;

    const rows = await this.prisma.client.$queryRaw<PublicProfileRow[]>(Prisma.sql`
      SELECT
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl",
        profile."bio" AS "bio",
        profile."status" AS "status"
      FROM "public_profile" AS profile
      JOIN "handle" AS handle ON handle."id" = profile."handleId"
      WHERE
        handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
        AND ${discoveryPredicate}
        AND ${searchPredicate}
      ORDER BY
        CASE
          WHEN handle."normalized" = ${handleQuery} THEN 0
          WHEN handle."normalized" LIKE ${handlePrefixPattern} THEN 1
          ELSE 2
        END,
        lower(profile."displayName") ASC,
        handle."normalized" ASC,
        profile."userId" ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => toPublicProfile(row));
  }

  async updateMine(
    actorUserId: string,
    input: UpdatePublicProfile,
  ): Promise<PublicProfile | null> {
    const current = await this.findByUserId(actorUserId);
    if (!current) {
      return null;
    }

    await this.prisma.client.publicProfile.update({
      where: { userId: actorUserId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    return this.findByUserId(actorUserId);
  }

  async resolveDirectChatPeer(
    actorUserId: string,
    handleInput: string,
  ): Promise<{ userId: string } | null> {
    const handle = handleInputSchema.parse(handleInput);
    const rows = await this.prisma.client.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT profile."userId" AS "userId"
      FROM "public_profile" AS profile
      JOIN "handle" AS handle ON handle."id" = profile."handleId"
      WHERE
        handle."normalized" = ${handle}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
      LIMIT 1
    `);
    const target = rows[0];
    if (
      !target ||
      target.userId === actorUserId ||
      !(await this.accessPolicy.canStartDirectChat(actorUserId, target.userId))
    ) {
      return null;
    }
    return target;
  }

  private async findByUserId(userId: string): Promise<PublicProfile | null> {
    const rows = await this.prisma.client.$queryRaw<PublicProfileRow[]>(Prisma.sql`
      SELECT
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl",
        profile."bio" AS "bio",
        profile."status" AS "status"
      FROM "public_profile" AS profile
      JOIN "handle" AS handle ON handle."id" = profile."handleId"
      WHERE
        profile."userId" = ${userId}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
      LIMIT 1
    `);
    const row = rows[0];
    return row ? toPublicProfile(row) : null;
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toPublicProfile(row: PublicProfileRow): PublicProfile {
  return publicProfileSchema.parse({
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    status: row.status,
  });
}
