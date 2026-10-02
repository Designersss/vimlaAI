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
  type InboxResponse,
  type ListInboxQuery,
} from "@vimla/contracts";
import {
  Prisma,
  type PrismaClient,
} from "@vimla/database";
import {
  API_CONFIG,
  type ApiRuntimeConfig,
} from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";

const CURSOR_VERSION = 1 as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AiThreadInboxPreview = Extract<
  InboxItem,
  { surfaceKind: "AI_THREAD" }
>["preview"];

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
          { createdAt: "desc" as const },
          { id: "desc" as const },
        ],
        take: 1,
      },
    },
  },
  directConversation: {
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      messages: {
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
    const authorityBranches =
      this.authorityBranches(
        userId,
        query.kind,
        normalizedSearch,
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
    const items = page.map((row) =>
      this.toItem(
        userId,
        row,
        unreadCounts,
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
    return this.toItem(
      userId,
      row,
      unreadCounts,
    );
  }

  private authorityBranches(
    userId: string,
    kind: CommunicationSurfaceKind | undefined,
    normalizedSearch: string | null,
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

    if (
      this.config.directChatsEnabled &&
      (!kind || kind === "DIRECT")
    ) {
      branches.push({
        kind: "DIRECT",
        directConversation: {
          is: {
            AND: [
              {
                members: {
                  some: { userId },
                },
              },
              ...(normalizedSearch
                ? [
                    {
                      members: {
                        some: {
                          userId: {
                            not: userId,
                          },
                          user: {
                            OR: [
                              {
                                name: {
                                  contains:
                                    normalizedSearch,
                                  mode: "insensitive" as const,
                                },
                              },
                              {
                                email: {
                                  contains:
                                    normalizedSearch,
                                  mode: "insensitive" as const,
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      });
    }

    return branches;
  }

  private toItem(
    userId: string,
    row: InboxSurfaceRow,
    unreadCounts: ReadonlyMap<string, number>,
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

      const peerName =
        boundedInboxPeerName(peer.user.name);
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
        title: peerName,
        peer: {
          userId: peer.user.id,
          name: peerName,
          avatarUrl: null,
        },
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
          AND (
            member."lastReadMessageCreatedAt" IS NULL
            OR message."createdAt" > member."lastReadMessageCreatedAt"
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
