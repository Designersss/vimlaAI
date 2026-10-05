import { Inject, Injectable } from "@nestjs/common";
import {
  handleInputSchema,
  publicProfileSchema,
  type PublicProfile,
  type UpdatePublicProfile,
} from "@vimla/contracts";
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
    if (!row || !(await this.accessPolicy.canDiscover(actorUserId, row.userId))) {
      return null;
    }
    return toPublicProfile(row);
  }

  async search(actorUserId: string, query: string, limit: number): Promise<PublicProfile[]> {
    const trimmed = query.trim();
    const handleQuery = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 90);
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
        AND (
          strpos(lower(handle."normalized"), ${handleQuery}) > 0
          OR strpos(lower(profile."displayName"), lower(${trimmed})) > 0
        )
      ORDER BY
        CASE
          WHEN handle."normalized" = ${handleQuery} THEN 0
          WHEN strpos(lower(handle."normalized"), ${handleQuery}) = 1 THEN 1
          ELSE 2
        END,
        lower(profile."displayName") ASC,
        handle."normalized" ASC,
        profile."userId" ASC
      LIMIT ${fetchLimit}
    `);

    const decisions = await Promise.all(
      rows.map(async (row) => ({
        row,
        allowed: await this.accessPolicy.canDiscover(actorUserId, row.userId),
      })),
    );
    return decisions
      .filter((entry) => entry.allowed)
      .slice(0, limit)
      .map((entry) => toPublicProfile(entry.row));
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
