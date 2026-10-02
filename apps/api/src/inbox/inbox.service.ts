import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  INBOX_LIMITS,
  directMessageKindSchema,
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
    const normalizedSearch = query.q?.trim() || null;
    const filterKey = cursorFilterKey(
      query.kind ?? null,
      normalizedSearch,
    );
    const cursor = query.cursor
      ? decodeCursor(query.cursor, filterKey)
      : null;

    const authorityBranches: Prisma.CommunicationSurfaceWhereInput[] =
      [];

    if (!query.kind || query.kind === "AI_THREAD") {
      authorityBranches.push({
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
      (!query.kind || query.kind === "DIRECT")
    ) {
      authorityBranches.push({
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
                          userId: { not: userId },
                          user: {
                            name: {
                              contains: normalizedSearch,
                              mode: "insensitive" as const,
                            },
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

    if (authorityBranches.length === 0) {
      return { items: [], nextCursor: null };
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
                            id: { lt: cursor.id },
                          },
                        ],
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        include: {
          conversation: {
            include: {
              messages: {
                orderBy: [
                  { createdAt: "desc" },
                  { id: "desc" },
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
                  { createdAt: "desc" },
                  { id: "desc" },
                ],
                take: 1,
              },
            },
          },
        },
        orderBy: [
          { lastActivityAt: "desc" },
          { id: "desc" },
        ],
        take: query.limit + 1,
      });

    const page = rows.slice(0, query.limit);
    const unreadCounts =
      await this.readDirectUnreadCounts(
        userId,
        page
          .map(
            (row) =>
              row.directConversation?.id ?? null,
          )
          .filter(
            (id): id is string => id !== null,
          ),
      );

    const items = page.map((row): InboxItem => {
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
        const latest = conversation.messages[0];
        const preview =
          latest &&
          (latest.role === "USER" ||
            latest.role === "ASSISTANT")
            ? {
                kind: "SERVER_TEXT" as const,
                messageId: latest.id,
                role: latest.role,
                text: compactServerPreview(
                  latest.content,
                ),
              }
            : { kind: "NONE" as const };

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
        const mine = conversation.members.find(
          (member) => member.userId === userId,
        );
        const peer = conversation.members.find(
          (member) => member.userId !== userId,
        );
        if (!mine || !peer) {
          throw new Error(
            "Direct inbox membership is invalid",
          );
        }
        const latest = conversation.messages[0];
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
                messageKind: parsedKind.data,
                createdAt:
                  latest.createdAt.toISOString(),
              }
            : { kind: "NONE" as const };

        return {
          surfaceId: row.id,
          surfaceKind: "DIRECT",
          domainId: conversation.id,
          title: peer.user.name,
          peer: {
            userId: peer.user.id,
            name: peer.user.name,
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
    });

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

function compactServerPreview(
  value: string,
): string {
  return Array.from(
    value.trim().replace(/\s+/g, " "),
  )
    .slice(0, INBOX_LIMITS.serverPreviewMax)
    .join("");
}

function cursorFilterKey(
  kind: string | null,
  query: string | null,
): string {
  return JSON.stringify({
    kind,
    q: query?.toLowerCase() ?? null,
  });
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
      Buffer.from(value, "base64url").toString(
        "utf8",
      ),
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
      decoded.filterKey !== expectedFilterKey
    ) {
      throw new Error("invalid cursor");
    }
    const at = new Date(decoded.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error("invalid cursor time");
    }
    return { at, id: decoded.id };
  } catch {
    throw new BadRequestException(
      "Invalid inbox cursor",
    );
  }
}
