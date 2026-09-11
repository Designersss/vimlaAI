import type { Prisma } from "@vimla/database";
import {
  WORKSPACE_LIMITS,
  type CreateTask,
  type TaskView,
  type UpdateTask,
} from "@vimla/contracts";
import { WorkspaceError } from "./errors.js";
import {
  decodeTaskCursor,
  encodeTaskCursor,
  isActiveTaskStatus,
  isTaskListGroupStart,
  taskListGroupStart,
  type TaskListCursor,
} from "./task-order.js";
import type { ActorContext, DbClient, ListQuery, TrustedSourceContext } from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toTaskView(row: {
  id: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  task: {
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
    assignedByUserId: string | null;
    assignedBy: { id: string; name: string } | null;
  } | null;
}): TaskView {
  if (!row.task) {
    throw new WorkspaceError("NOT_FOUND", "Task not found");
  }
  return {
    id: row.id,
    kind: "TASK",
    title: row.task.title,
    description: row.task.description,
    status: row.task.status as TaskView["status"],
    priority: row.task.priority as TaskView["priority"],
    dueAt: iso(row.task.dueAt),
    completedAt: iso(row.task.completedAt),
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedByUserId: row.task.assignedByUserId,
    assignedByName: row.task.assignedBy?.name ?? null,
  };
}

export interface TaskAssignment {
  ownerUserId: string;
  assignedByUserId: string | null;
  assignmentSourceType: string | null;
  assignmentSourceId: string | null;
}

export function completedAtForStatus(status: string, at: Date): Date | null {
  return status === "DONE" ? at : null;
}

export class TaskService {
  constructor(private readonly db: DbClient) {}

  async create(
    actor: ActorContext,
    input: CreateTask,
    source?: TrustedSourceContext,
    assignment?: TaskAssignment,
  ): Promise<TaskView> {
    const status = input.status ?? "TODO";
    if (status === "DONE") {
      throw new WorkspaceError("STATUS_INVALID", "New tasks cannot start as DONE");
    }
    const ownerUserId = assignment?.ownerUserId ?? actor.userId;
    const assignedByUserId =
      assignment?.assignedByUserId && assignment.assignedByUserId !== ownerUserId ? assignment.assignedByUserId : null;
    const now = new Date();
    const created = await this.db.workspaceObject.create({
      data: {
        kind: "TASK",
        scopeType: "PERSONAL",
        personalOwnerUserId: ownerUserId,
        createdByUserId: actor.userId,
        sourceConversationId: source?.conversationId,
        sourceMessageId: source?.messageId,
        task: {
          create: {
            title: input.title,
            description: input.description ?? null,
            status,
            priority: input.priority ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            completedAt: completedAtForStatus(status, now),
            assignedByUserId,
            assignmentSourceType: assignedByUserId ? assignment?.assignmentSourceType ?? null : null,
            assignmentSourceId: assignedByUserId ? assignment?.assignmentSourceId ?? null : null,
          },
        },
      },
      include: { task: { include: { assignedBy: { select: { id: true, name: true } } } } },
    });
    return toTaskView(created);
  }

  async get(actor: ActorContext, id: string): Promise<TaskView> {
    const row = await this.load(actor, id);
    return toTaskView(row);
  }

  async list(
    actor: ActorContext,
    query: ListQuery & { status?: CreateTask["status"]; dueFrom?: string; dueTo?: string },
  ): Promise<{ items: TaskView[]; nextCursor: string | null }> {
    const cursor = decodeTaskCursor(query.cursor);
    const base = this.baseWhere(actor, query);
    if (query.status && isActiveTaskStatus(query.status)) {
      return this.pageGroup(base, "a", query.status, cursor?.g === "a" ? cursor : undefined, query.limit);
    }
    if (query.status) {
      return this.pageGroup(base, "f", query.status, cursor?.g === "f" ? cursor : undefined, query.limit);
    }
    if (!cursor || cursor.g === "a") {
      const active = await this.fetchGroup(base, "a", undefined, cursor, query.limit + 1);
      if (active.length > query.limit) {
        const page = active.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(toTaskView),
          nextCursor: last ? encodeTaskCursor(cursorFromRow(last, "a")) : null,
        };
      }
      const remaining = query.limit - active.length;
      if (remaining === 0) {
        const peek = await this.fetchGroup(base, "f", undefined, undefined, 1);
        return {
          items: active.map(toTaskView),
          nextCursor: peek.length > 0 ? encodeTaskCursor(taskListGroupStart("f")) : null,
        };
      }
      const finished = await this.fetchGroup(base, "f", undefined, undefined, remaining + 1);
      const page = [...active, ...finished.slice(0, remaining)];
      const last = page.at(-1);
      const overflow = finished.length > remaining;
      return {
        items: page.map(toTaskView),
        nextCursor: overflow && last ? encodeTaskCursor(cursorFromRow(last, "f")) : null,
      };
    }
    return this.pageGroup(base, "f", undefined, cursor, query.limit);
  }

  private baseWhere(
    actor: ActorContext,
    query: ListQuery & { dueFrom?: string; dueTo?: string },
  ): Prisma.WorkspaceObjectWhereInput {
    return {
      personalOwnerUserId: actor.userId,
      kind: "TASK",
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      task: {
        is: {
          ...(query.dueFrom || query.dueTo
            ? {
                dueAt: {
                  ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
                  ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
                },
              }
            : {}),
        },
      },
    };
  }

  private async pageGroup(
    base: Prisma.WorkspaceObjectWhereInput,
    group: "a" | "f",
    status: string | undefined,
    cursor: TaskListCursor | undefined,
    limit: number,
  ): Promise<{ items: TaskView[]; nextCursor: string | null }> {
    const rows = await this.fetchGroup(base, group, status, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toTaskView),
      nextCursor: rows.length > limit && last ? encodeTaskCursor(cursorFromRow(last, group)) : null,
    };
  }

  private async fetchGroup(
    base: Prisma.WorkspaceObjectWhereInput,
    group: "a" | "f",
    status: string | undefined,
    cursor: TaskListCursor | undefined,
    take: number,
  ) {
    const statuses = status ? [status] : group === "a" ? ["TODO", "IN_PROGRESS"] : ["DONE", "CANCELED"];
    const where: Prisma.WorkspaceObjectWhereInput = {
      ...base,
      AND: [
        ...(Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : []),
        { task: { is: { status: { in: statuses } } } },
        ...(cursor && !isTaskListGroupStart(cursor) ? [groupAfterCursor(group, cursor)] : []),
      ],
    };
    return this.db.workspaceObject.findMany({
      where,
      include: { task: { include: { assignedBy: { select: { id: true, name: true } } } } },
      orderBy: group === "a" ? activeOrderBy : finishedOrderBy,
      take,
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateTask): Promise<TaskView> {
    const existing = await this.load(actor, id);
    if (!existing.task) {
      throw new WorkspaceError("NOT_FOUND", "Task not found");
    }
    const nextStatus = input.status ?? existing.task.status;
    const now = new Date();
    const completedAt = completedAtForStatus(nextStatus, existing.task.completedAt ?? now);
    await this.db.workspaceObject.update({
      where: { id },
      data: {
        archivedAt:
          input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null,
        task: {
          update: {
            title: input.title ?? existing.task.title,
            description: input.description === undefined ? existing.task.description : input.description,
            status: nextStatus,
            priority: input.priority === undefined ? existing.task.priority : input.priority,
            dueAt: input.dueAt === undefined ? existing.task.dueAt : input.dueAt ? new Date(input.dueAt) : null,
            completedAt,
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

  private async load(actor: ActorContext, id: string) {
    const row = await this.db.workspaceObject.findFirst({
      where: { id, personalOwnerUserId: actor.userId, kind: "TASK", deletedAt: null },
      include: { task: { include: { assignedBy: { select: { id: true, name: true } } } } },
    });
    if (!row) {
      throw new WorkspaceError("NOT_FOUND", "Task not found");
    }
    return row;
  }
}

type TaskListRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  task: { dueAt: Date | null } | null;
};

function cursorFromRow(row: TaskListRow, group: "a" | "f"): TaskListCursor {
  return {
    g: group,
    due: row.task?.dueAt?.toISOString() ?? "",
    u: row.updatedAt.toISOString(),
    c: row.createdAt.toISOString(),
    id: row.id,
  };
}

const activeOrderBy: Prisma.WorkspaceObjectOrderByWithRelationInput[] = [
  { task: { dueAt: { sort: "asc", nulls: "last" } } },
  { updatedAt: "desc" },
  { createdAt: "asc" },
  { id: "asc" },
];

const finishedOrderBy: Prisma.WorkspaceObjectOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

function remainingAfterCursor(cursor: TaskListCursor, direction: "active" | "finished"): Prisma.WorkspaceObjectWhereInput {
  const updatedAt = new Date(cursor.u);
  const createdAt = new Date(cursor.c);
  if (direction === "finished") {
    return {
      OR: [
        { updatedAt: { lt: updatedAt } },
        { AND: [{ updatedAt }, { createdAt: { lt: createdAt } }] },
        { AND: [{ updatedAt }, { createdAt }, { id: { lt: cursor.id } }] },
      ],
    };
  }
  return {
    OR: [
      { updatedAt: { lt: updatedAt } },
      { AND: [{ updatedAt }, { createdAt: { gt: createdAt } }] },
      { AND: [{ updatedAt }, { createdAt }, { id: { gt: cursor.id } }] },
    ],
  };
}

function groupAfterCursor(group: "a" | "f", cursor: TaskListCursor): Prisma.WorkspaceObjectWhereInput {
  if (group === "f") {
    return remainingAfterCursor(cursor, "finished");
  }
  const remaining = remainingAfterCursor(cursor, "active");
  if (!cursor.due) {
    return {
      AND: [{ task: { is: { dueAt: null } } }, remaining],
    };
  }
  const dueAt = new Date(cursor.due);
  return {
    OR: [
      { task: { is: { dueAt: { gt: dueAt } } } },
      { AND: [{ task: { is: { dueAt: dueAt } } }, remaining] },
      { task: { is: { dueAt: null } } },
    ],
  };
}

export function assertTaskContentLimits(title: string, description?: string | null): void {
  if (title.length > WORKSPACE_LIMITS.titleMax) {
    throw new WorkspaceError("PAYLOAD_TOO_LARGE", "Task title is too long");
  }
  if (description && description.length > WORKSPACE_LIMITS.taskDescriptionMax) {
    throw new WorkspaceError("PAYLOAD_TOO_LARGE", "Task description is too long");
  }
}
