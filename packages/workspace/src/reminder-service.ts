import type { Prisma } from "@vimla/database";
import type { CreateReminder, ReminderView, UpdateReminder } from "@vimla/contracts";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { WorkspaceError } from "./errors.js";
import { assertIanaTimeZone } from "./timezone.js";
import type { ActorContext, DbClient, ListQuery, TrustedSourceContext } from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toView(row: {
  id: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reminder: {
    title: string;
    description: string | null;
    scheduledAt: Date;
    timezone: string;
    status: string;
    linkedTaskObjectId: string | null;
  } | null;
}): ReminderView {
  if (!row.reminder) {
    throw new WorkspaceError("NOT_FOUND", "Reminder not found");
  }
  return {
    id: row.id,
    kind: "REMINDER",
    title: row.reminder.title,
    description: row.reminder.description,
    scheduledAt: row.reminder.scheduledAt.toISOString(),
    timezone: row.reminder.timezone,
    status: row.reminder.status as ReminderView["status"],
    linkedTaskId: row.reminder.linkedTaskObjectId,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ReminderService {
  constructor(private readonly db: DbClient) {}

  async create(
    actor: ActorContext,
    input: CreateReminder,
    options: { timezone: string; source?: TrustedSourceContext },
  ): Promise<ReminderView> {
    const timezone = assertIanaTimeZone(input.timezone ?? options.timezone);
    await this.assertLinkedTask(actor, input.linkedTaskId ?? null);
    const created = await this.db.workspaceObject.create({
      data: {
        kind: "REMINDER",
        scopeType: "PERSONAL",
        personalOwnerUserId: actor.userId,
        createdByUserId: actor.userId,
        sourceConversationId: options.source?.conversationId,
        sourceMessageId: options.source?.messageId,
        reminder: {
          create: {
            title: input.title,
            description: input.description ?? null,
            scheduledAt: new Date(input.scheduledAt),
            timezone,
            status: "PENDING",
            linkedTaskObjectId: input.linkedTaskId ?? null,
          },
        },
      },
      include: { reminder: true },
    });
    return toView(created);
  }

  async get(actor: ActorContext, id: string): Promise<ReminderView> {
    return toView(await this.load(actor, id));
  }

  async list(
    actor: ActorContext,
    query: ListQuery & { status?: ReminderView["status"] },
  ): Promise<{ items: ReminderView[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.WorkspaceObjectWhereInput = {
      personalOwnerUserId: actor.userId,
      kind: "REMINDER",
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      reminder: {
        is: {
          status: query.status ?? "PENDING",
        },
      },
      ...(cursor
        ? {
            OR: [
              { reminder: { is: { scheduledAt: { gt: new Date(cursor.t) } } } },
              {
                AND: [
                  { reminder: { is: { scheduledAt: new Date(cursor.t) } } },
                  { id: { gt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    };
    const rows = await this.db.workspaceObject.findMany({
      where,
      include: { reminder: true },
      orderBy: [{ reminder: { scheduledAt: "asc" } }, { id: "asc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const lastScheduledAt = last?.reminder?.scheduledAt;
    return {
      items: page.map(toView),
      nextCursor:
        rows.length > query.limit && last && lastScheduledAt
          ? encodeCursor({ id: last.id, t: lastScheduledAt.toISOString() })
          : null,
    };
  }

  async update(actor: ActorContext, id: string, input: UpdateReminder): Promise<ReminderView> {
    const existing = await this.load(actor, id);
    if (!existing.reminder) {
      throw new WorkspaceError("NOT_FOUND", "Reminder not found");
    }
    if (input.linkedTaskId !== undefined) {
      await this.assertLinkedTask(actor, input.linkedTaskId);
    }
    let status = existing.reminder.status;
    let canceledAt = existing.reminder.canceledAt;
    if (input.status === "CANCELED") {
      status = "CANCELED";
      canceledAt = canceledAt ?? new Date();
    } else if (input.status === "PENDING") {
      if (existing.reminder.status === "DELIVERED" || existing.reminder.status === "FAILED") {
        throw new WorkspaceError("STATUS_INVALID", "Delivered reminders cannot be reopened");
      }
      status = "PENDING";
      canceledAt = null;
    }
    const timezone = input.timezone ? assertIanaTimeZone(input.timezone) : existing.reminder.timezone;
    const now = new Date();
    await this.db.workspaceObject.update({
      where: { id },
      data: {
        archivedAt:
          input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null,
        reminder: {
          update: {
            title: input.title ?? existing.reminder.title,
            description: input.description === undefined ? existing.reminder.description : input.description,
            scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : existing.reminder.scheduledAt,
            timezone,
            status,
            canceledAt,
            linkedTaskObjectId:
              input.linkedTaskId === undefined ? existing.reminder.linkedTaskObjectId : input.linkedTaskId,
          },
        },
      },
    });
    return this.get(actor, id);
  }

  async delete(actor: ActorContext, id: string): Promise<void> {
    await this.load(actor, id);
    await this.db.workspaceObject.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertLinkedTask(actor: ActorContext, taskId: string | null): Promise<void> {
    if (!taskId) {
      return;
    }
    const task = await this.db.workspaceObject.findFirst({
      where: { id: taskId, personalOwnerUserId: actor.userId, kind: "TASK", deletedAt: null },
    });
    if (!task) {
      throw new WorkspaceError("NOT_FOUND", "Linked task not found");
    }
  }

  private async load(actor: ActorContext, id: string) {
    const row = await this.db.workspaceObject.findFirst({
      where: { id, personalOwnerUserId: actor.userId, kind: "REMINDER", deletedAt: null },
      include: { reminder: true },
    });
    if (!row) {
      throw new WorkspaceError("NOT_FOUND", "Reminder not found");
    }
    return row;
  }
}
