import type { Prisma, PrismaClient } from "@vimla/database";
import type { NotificationsResponse, UnreadCountResponse, UserNotificationView } from "@vimla/contracts";
import { decodeNotificationCursor, encodeNotificationCursor } from "./cursor.js";
import { sanitizeHrefPath } from "./destinations.js";
import { NotificationPlatformError } from "./errors.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export class NotificationInboxService {
  constructor(private readonly db: PrismaClient) {}

  async list(userId: string, query: { limit: number; cursor?: string }): Promise<NotificationsResponse> {
    const cursor = decodeNotificationCursor(query.cursor);
    const where: Prisma.UserNotificationWhereInput = {
      userId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.t) } },
              {
                AND: [{ createdAt: new Date(cursor.t) }, { id: { lt: cursor.id } }],
              },
            ],
          }
        : {}),
    };
    const rows = await this.db.userNotification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const sourceIds = page
      .map((row) => row.sourceId)
      .filter((id): id is string => typeof id === "string");
    const available = await this.availableSources(userId, sourceIds);
    const last = page.at(-1);
    return {
      items: page.map((row) => toView(row, row.sourceId ? available.has(row.sourceId) : false)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeNotificationCursor({ id: last.id, t: last.createdAt.toISOString() })
          : null,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponse> {
    const count = await this.db.userNotification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<UserNotificationView> {
    const existing = await this.db.userNotification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotificationPlatformError("NOT_FOUND", "Notification not found");
    }
    const updated =
      existing.readAt === null
        ? await this.db.userNotification.update({
            where: { id },
            data: { readAt: new Date() },
          })
        : existing;
    const available = updated.sourceId
      ? await this.availableSources(userId, [updated.sourceId])
      : new Set<string>();
    return toView(updated, updated.sourceId ? available.has(updated.sourceId) : false);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.db.userNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  private async availableSources(userId: string, sourceIds: string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) {
      return new Set();
    }
    const rows = await this.db.workspaceObject.findMany({
      where: {
        id: { in: sourceIds },
        personalOwnerUserId: userId,
        kind: "REMINDER",
        deletedAt: null,
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}

function toView(
  row: {
    id: string;
    type: string;
    sourceType: string;
    sourceId: string | null;
    title: string;
    body: string | null;
    hrefPath: string | null;
    createdAt: Date;
    readAt: Date | null;
  },
  sourceAvailable: boolean,
): UserNotificationView {
  return {
    id: row.id,
    type: row.type as UserNotificationView["type"],
    sourceType: row.sourceType as UserNotificationView["sourceType"],
    sourceId: row.sourceId,
    title: row.title,
    body: row.body,
    hrefPath: sanitizeHrefPath(row.hrefPath),
    createdAt: row.createdAt.toISOString(),
    readAt: iso(row.readAt),
    sourceAvailable,
  };
}
