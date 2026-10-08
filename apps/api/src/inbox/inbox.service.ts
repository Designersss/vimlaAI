import { createHash } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  INBOX_LIMITS,
  directMessageKindSchema,
  type CommunicationSurfaceKind,
  type InboxItem,
  type InboxPeerSummary,
  type InboxResponse,
  type ListInboxQuery,
} from "@vimla/contracts";
import { PUBLIC_PROFILE_LIMITS } from "@vimla/contracts/public-profiles";
import {
  Prisma,
  type PrismaClient,
} from "@vimla/database";
import {
  API_CONFIG,
  type ApiRuntimeConfig,
} from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  PEOPLE_ACCESS_POLICY,
  type PeopleAccessPolicy,
} from "../people/people-access-policy.js";

const CURSOR_VERSION = 1 as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AiThreadInboxPreview = Extract<
  InboxItem,
  { surfaceKind: "AI_THREAD" }
>["preview"];

type PublicProfileRow = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

function toServerPreviewRole(
  role: string,
): "USER" | "ASSISTANT" | null {
  if (role === "USER" || role === "ASSISTANT") {
    return role;
  }

  return null;
}

const surfaceInclude = {
  conversation: {
    include: {
      messages: {
        orderBy: [
          { updatedAt: "desc" as const },
          { id: "desc" as const },
        ],
        take: 1,
      },
    },
  },
  directConversation: {
    include: {
      members: true,
      messages: {
        where: { kind: { not: "REACTION" } },
        orderBy: [
          { createdAt: "desc" as const },
          { id: "desc" as const },
        ],
        take: 1,
      },
    },
  },
} satisfies Prisma.CommunicationSurfaceInclude;

type InboxSurfaceRow =
  Prisma.CommunicationSurfaceGetPayload<{
    include: typeof surfaceInclude;
  }>;

type DecodedCursor = {
  at: Date;
  id: string;
};

type UnreadCountRow = {
  conversationId: string;
  unreadCount: number;
};

@Injectable()
export class InboxService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(API_CONFIG)
    private readonly config: ApiRuntimeConfig,
    @Inject(PEOPLE_ACCESS_POLICY)
    private readonly peopleAccess: PeopleAccessPolicy,
  ) {}

  private get prisma(): PrismaClient {
    return this.prismaService.client;
  }

  async list(
    userId: string,
    query: ListInboxQuery,
  ): Promise<InboxResponse> {
    const normalizedSearch =
      query.q?.trim() || null;
    const filterKey = cursorFilterKey(
      query.kind ?? null,
      normalizedSearch,
    );
    const cursor = query.cursor
      ? decodeCursor(query.cursor, filterKey)
      : null;
    const matchingDirectSurfaceIds =
      normalizedSearch &&
      this.config.directChatsEnabled &&
      (!query.kind || query.kind === "DIRECT")
        ? await this.findMatchingDirectSurfaceIds(
            userId,
            normalizedSearch,
            cursor,
            query.limit + 1,
          )
        : null;
    const authorityBranches =
      this.authorityBranches(
        userId,
        query.kind,
        normalizedSearch,
        matchingDirectSurfaceIds,
      );

    if (authorityBranches.length === 0) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    const rows =
      await this.prisma.communicationSurface.findMany({
        where: {
          status: "ACTIVE",
          AND: [
            { OR: authorityBranches },
            ...(cursor
              ? [
                  {
                    OR: [
                      {
                        lastActivityAt: {
                          lt: cursor.at,
                        },
                      },
                      {
                        AND: [
                          {
                            lastActivityAt:
                              cursor.at,
                          },
                          {
                            id: {
                              lt: cursor.id,
                            },
                          },
                        ],
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        include: surfaceInclude,
        orderBy: [
          { lastActivityAt: "desc" },
          { id: "desc" },
        ],
        take: query.limit + 1,
      });

    const page = rows.slice(
      0,
      query.limit,
    );
    const unreadCounts =
      await this.readDirectUnreadCounts(
        userId,
        directConversationIds(page),
      );
    const publicProfiles =
      await this.readPublicProfiles(
        directPeerUserIds(page, userId),
      );
    const items = page.map((row) =>
      this.toItem(
        userId,
        row,
        unreadCounts,
        publicProfiles,
      ),
    );

    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(
              last.lastActivityAt,
              last.id,
              filterKey,
            )
          : null,
    };
  }

  async get(
    userId: string,
    surfaceId: string,
  ): Promise<InboxItem | null> {
    const authorityBranches =
      this.authorityBranches(
        userId,
        undefined,
        null,
        null,
      );
    if (authorityBranches.length === 0) {
      return null;
    }

    const row =
      await this.prisma.communicationSurface.findFirst({
        where: {
          id: surfaceId,
          status: "ACTIVE",
          OR: authorityBranches,
        },
        include: surfaceInclude,
      });
    if (!row) {
      return null;
    }

    const unreadCounts =
      await this.readDirectUnreadCounts(
        userId,
        directConversationIds([row]),
      );
    const publicProfiles =
      await this.readPublicProfiles(
        directPeerUserIds([row], userId),
      );
    return this.toItem(
      userId,
      row,
      unreadCounts,
      publicProfiles,
    );
  }

  private authorityBranches(
    userId: string,
    kind: CommunicationSurfaceKind | undefined,
    normalizedSearch: string | null,
    matchingDirectSurfaceIds: readonly string[] | null,
  ): Prisma.CommunicationSurfaceWhereInput[] {
    const branches:
      Prisma.CommunicationSurfaceWhereInput[] =
      [];

    if (!kind || kind === "AI_THREAD") {
      branches.push({
        kind: "AI_THREAD",
        conversation: {
          is: {
            userId,
            kind: "CHAT",
            ...(normalizedSearch
              ? {
                  title: {
                    contains: normalizedSearch,
                    mode: "insensitive",
                  },
                }
              : {}),
          },
        },
      });
    }

    const directSearchHasMatches =
      !normalizedSearch ||
      (matchingDirectSurfaceIds !== null &&
        matchingDirectSurfaceIds.length > 0);
    if (
      this.config.directChatsEnabled &&
      (!kind || kind === "DIRECT") &&
      directSearchHasMatches
    ) {
      branches.push({
        kind: "DIRECT",
        ...(normalizedSearch && matchingDirectSurfaceIds
          ? {
              id: {
                in: [...matchingDirectSurfaceIds],
              },
            }
          : {}),
        directConversation: {
          is: {
            members: {
              some: { userId },
            },
          },
        },
      });
    }

    return branches;
  }

  private async findMatchingDirectSurfaceIds(
    userId: string,
    search: string,
    cursor: DecodedCursor | null,
    limit: number,
  ): Promise<string[]> {
    const identityQuery = search.startsWith("@")
      ? search.slice(1).trim()
      : search;
    if (!identityQuery) {
      return [];
    }

    const normalizedIdentity = identityQuery.toLowerCase();
    const identityLength = Array.from(identityQuery).length;
    const prefixSearch =
      identityLength >=
      PUBLIC_PROFILE_LIMITS.searchPrefixMatchMin;
    const containsSearch =
      identityLength >=
      PUBLIC_PROFILE_LIMITS.searchContainsMatchMin;
    const handlePrefixPattern =
      `${escapeLikePattern(normalizedIdentity)}%`;
    const displayPrefixPattern =
      `${escapeLikePattern(normalizedIdentity)}%`;
    const handleContainsPattern =
      `%${escapeLikePattern(normalizedIdentity)}%`;
    const displayContainsPattern =
      `%${escapeLikePattern(identityQuery)}%`;
    const matchPredicate = containsSearch
      ? Prisma.sql`(
          handle."normalized" LIKE ${handleContainsPattern}
          OR profile."displayName" ILIKE ${displayContainsPattern}
        )`
      : prefixSearch
        ? Prisma.sql`(
            handle."normalized" LIKE ${handlePrefixPattern}
            OR lower(profile."displayName") LIKE ${displayPrefixPattern}
          )`
        : Prisma.sql`(
            handle."normalized" = ${normalizedIdentity}
            OR lower(profile."displayName") = lower(${identityQuery})
          )`;
    const cursorPredicate = cursor
      ? Prisma.sql`AND (
          surface."lastActivityAt" < ${cursor.at}
          OR (
            surface."lastActivityAt" = ${cursor.at}
            AND surface."id" < ${cursor.id}::uuid
          )
        )`
      : Prisma.sql``;
    const discoveryPredicate =
      this.peopleAccess.discoveryAllowedSql(
        userId,
        Prisma.sql`peer."userId"`,
      );

    const rows = await this.prisma.$queryRaw<
      Array<{ surfaceId: string }>
    >(Prisma.sql`
      SELECT surface."id" AS "surfaceId"
      FROM "communication_surface" AS surface
      INNER JOIN "direct_conversation_member" AS mine
        ON mine."conversationId" = surface."directConversationId"
      INNER JOIN "direct_conversation_member" AS peer
        ON peer."conversationId" = mine."conversationId"
        AND peer."userId" <> mine."userId"
      INNER JOIN "public_profile" AS profile
        ON profile."userId" = peer."userId"
      INNER JOIN "handle" AS handle
        ON handle."id" = profile."handleId"
      WHERE
        surface."kind" = 'DIRECT'
        AND surface."status" = 'ACTIVE'
        AND mine."userId" = ${userId}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
        AND ${discoveryPredicate}
        AND ${matchPredicate}
        ${cursorPredicate}
      GROUP BY
        surface."id",
        surface."lastActivityAt"
      ORDER BY
        surface."lastActivityAt" DESC,
        surface."id" DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => row.surfaceId);
  }

  private async readPublicProfiles(
    userIds: string[],
  ): Promise<Map<string, InboxPeerSummary>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.$queryRaw<
      PublicProfileRow[]
    >(Prisma.sql`
      SELECT
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl"
      FROM "public_profile" AS profile
      INNER JOIN "handle" AS handle
        ON handle."id" = profile."handleId"
      WHERE
        profile."userId" IN (${Prisma.join(userIds)})
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
    `);
    return new Map(
      rows.map((row) => [
        row.userId,
        {
          userId: row.userId,
          handle: row.handle,
          name: boundedInboxPeerName(
            row.displayName,
          ),
          avatarUrl: row.avatarUrl,
        },
      ]),
    );
  }

  private toItem(
    userId: string,
    row: InboxSurfaceRow,
    unreadCounts: ReadonlyMap<string, number>,
    publicProfiles: ReadonlyMap<
      string,
      InboxPeerSummary
    >,
  ): InboxItem {
    if (row.kind === "AI_THREAD") {
      const conversation = row.conversation;
      if (
        !conversation ||
        conversation.userId !== userId ||
        conversation.kind !== "CHAT"
      ) {
        throw new Error(
          "AI thread inbox surface binding is invalid",
        );
      }

      const latest =
        conversation.messages[0];
      const previewRole = latest
        ? toServerPreviewRole(latest.role)
        : null;
      const preview: AiThreadInboxPreview =
        latest && previewRole
          ? {
              kind: "SERVER_TEXT",
              messageId: latest.id,
              role: previewRole,
              text: compactServerPreview(
                latest.content,
              ),
            }
          : { kind: "NONE" };

      return {
        surfaceId: row.id,
        surfaceKind: "AI_THREAD",
        domainId: conversation.id,
        title: conversation.title,
        peer: null,
        lastActivityAt:
          row.lastActivityAt.toISOString(),
        unreadCount: 0,
        preview,
        navigationTarget: {
          version: 1,
          kind: "CHAT",
          id: row.id,
        },
      };
    }

    if (row.kind === "DIRECT") {
      const conversation =
        row.directConversation;
      if (!conversation) {
        throw new Error(
          "Direct inbox surface binding is invalid",
        );
      }
      const mine =
        conversation.members.find(
          (member) =>
            member.userId === userId,
        );
      const peer =
        conversation.members.find(
          (member) =>
            member.userId !== userId,
        );
      if (!mine || !peer) {
        throw new Error(
          "Direct inbox membership is invalid",
        );
      }
      const peerProfile =
        publicProfiles.get(peer.userId);
      if (!peerProfile) {
        throw new Error(
          "Direct inbox public identity is invalid",
        );
      }

      const latest =
        conversation.messages[0];
      const parsedKind = latest
        ? directMessageKindSchema.safeParse(
            latest.kind,
          )
        : null;
      const preview =
        latest && parsedKind?.success
          ? {
              kind: "E2EE_LOCAL" as const,
              messageId: latest.id,
              senderUserId:
                latest.senderUserId,
              messageKind:
                parsedKind.data,
              createdAt:
                latest.createdAt.toISOString(),
            }
          : { kind: "NONE" as const };

      return {
        surfaceId: row.id,
        surfaceKind: "DIRECT",
        domainId: conversation.id,
        title: peerProfile.name,
        peer: peerProfile,
        lastActivityAt:
          row.lastActivityAt.toISOString(),
        unreadCount:
          unreadCounts.get(
            conversation.id,
          ) ?? 0,
        preview,
        navigationTarget: {
          version: 1,
          kind: "CHAT",
          id: row.id,
        },
      };
    }

    throw new Error(
      "Unsupported communication surface kind reached inbox",
    );
  }

  private async readDirectUnreadCounts(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const rows =
      await this.prisma.$queryRaw<
        UnreadCountRow[]
      >(Prisma.sql`
        SELECT
          message."conversationId" AS "conversationId",
          COUNT(*)::int AS "unreadCount"
        FROM "direct_message" AS message
        INNER JOIN "direct_conversation_member" AS member
          ON member."conversationId" = message."conversationId"
          AND member."userId" = ${userId}
        WHERE
          message."conversationId" IN (${Prisma.join(conversationIds)})
          AND message."senderUserId" <> ${userId}
          AND message."kind" <> 'REACTION'
          AND (
            member."lastReadMessageSequence" IS NULL
            OR message."sequence" > member."lastReadMessageSequence"
          )
        GROUP BY message."conversationId"
      `);

    return new Map(
      rows.map((row) => [
        row.conversationId,
        row.unreadCount,
      ]),
    );
  }
}

function directConversationIds(
  rows: readonly InboxSurfaceRow[],
): string[] {
  return rows
    .map(
      (row) =>
        row.directConversation?.id ??
        null,
    )
    .filter(
      (id): id is string => id !== null,
    );
}

function directPeerUserIds(
  rows: readonly InboxSurfaceRow[],
  userId: string,
): string[] {
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.directConversation?.members
          .filter(
            (member) =>
              member.userId !== userId,
          )
          .map((member) => member.userId) ?? [],
      ),
    ),
  ];
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function boundedInboxPeerName(
  value: string,
): string {
  const compact = value
    .trim()
    .replace(/\s+/g, " ");
  return (compact || "User").slice(
    0,
    INBOX_LIMITS.peerNameMax,
  );
}

function compactServerPreview(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(
      0,
      INBOX_LIMITS.serverPreviewMax,
    );
}

function cursorFilterKey(
  kind: string | null,
  query: string | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind,
        q: query,
      }),
      "utf8",
    )
    .digest("base64url");
}

function encodeCursor(
  at: Date,
  id: string,
  filterKey: string,
): string {
  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      at: at.toISOString(),
      id,
      filterKey,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  value: string,
  expectedFilterKey: string,
): DecodedCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(
        value,
        "base64url",
      ).toString("utf8"),
    ) as unknown;
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      !("v" in decoded) ||
      decoded.v !== CURSOR_VERSION ||
      !("at" in decoded) ||
      typeof decoded.at !== "string" ||
      !("id" in decoded) ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id) ||
      !("filterKey" in decoded) ||
      decoded.filterKey !==
        expectedFilterKey
    ) {
      throw new Error("invalid cursor");
    }
    const at = new Date(decoded.at);
    if (
      Number.isNaN(at.getTime()) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        decoded.at,
      ) ||
      at.toISOString() !== decoded.at
    ) {
      throw new Error(
        "invalid cursor time",
      );
    }
    return {
      at,
      id: decoded.id,
    };
  } catch {
    throw new BadRequestException(
      "Invalid inbox cursor",
    );
  }
}
