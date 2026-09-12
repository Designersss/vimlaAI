import type { Prisma, PrismaClient } from "@vimla/database";
import {
  WORKSPACE_LIMITS,
  type CreateList,
  type CreateListItem,
  type ListView,
  type ReorderListItems,
  type UpdateList,
  type UpdateListItem,
} from "@vimla/contracts";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { WorkspaceError } from "./errors.js";
import type { ActorContext, DbClient, ListQuery, TrustedSourceContext } from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toView(row: {
  id: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  list: {
    type: string;
    title: string;
    description: string | null;
    items: Array<{
      id: string;
      text: string;
      position: number;
      completedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
}): ListView {
  if (!row.list) {
    throw new WorkspaceError("NOT_FOUND", "List not found");
  }
  const items = [...row.list.items].sort((left, right) => left.position - right.position);
  return {
    id: row.id,
    kind: "LIST",
    type: row.list.type as ListView["type"],
    title: row.list.title,
    description: row.list.description,
    items: items.map((item) => ({
      id: item.id,
      text: item.text,
      position: item.position,
      completedAt: iso(item.completedAt),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listInclude = { list: { include: { items: true } } } as const;

export function assertReorderIds(currentIds: readonly string[], itemIds: readonly string[]): void {
  const current = new Set(currentIds);
  if (current.size !== itemIds.length || itemIds.some((id) => !current.has(id))) {
    throw new WorkspaceError("REORDER_INVALID", "Reorder must include every item exactly once");
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new WorkspaceError("REORDER_INVALID", "Reorder contains duplicates");
  }
}

export class ListService {
  constructor(private readonly db: DbClient) {}

  async create(actor: ActorContext, input: CreateList, source?: TrustedSourceContext): Promise<ListView> {
    const created = await this.db.workspaceObject.create({
      data: {
        kind: "LIST",
        scopeType: "PERSONAL",
        personalOwnerUserId: actor.userId,
        createdByUserId: actor.userId,
        sourceConversationId: source?.conversationId,
        sourceMessageId: source?.messageId,
        list: {
          create: {
            type: input.type,
            title: input.title,
            description: input.description ?? null,
          },
        },
      },
      include: listInclude,
    });
    return toView(created);
  }

  async get(actor: ActorContext, id: string): Promise<ListView> {
    return toView(await this.load(actor, id));
  }

  async list(
    actor: ActorContext,
    query: ListQuery & { type?: ListView["type"] },
  ): Promise<{ items: ListView[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.WorkspaceObjectWhereInput = {
      personalOwnerUserId: actor.userId,
      kind: "LIST",
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      list: query.type ? { is: { type: query.type } } : undefined,
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: new Date(cursor.t) } },
              { AND: [{ updatedAt: new Date(cursor.t) }, { id: { lt: cursor.id } }] },
            ],
          }
        : {}),
    };
    const rows = await this.db.workspaceObject.findMany({
      where,
      include: listInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toView),
      nextCursor:
        rows.length > query.limit && last ? encodeCursor({ id: last.id, t: last.updatedAt.toISOString() }) : null,
    };
  }

  async update(actor: ActorContext, id: string, input: UpdateList): Promise<ListView> {
    const existing = await this.load(actor, id);
    if (!existing.list) {
      throw new WorkspaceError("NOT_FOUND", "List not found");
    }
    const now = new Date();
    await this.db.workspaceObject.update({
      where: { id },
      data: {
        archivedAt:
          input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null,
        list: {
          update: {
            title: input.title ?? existing.list.title,
            description: input.description === undefined ? existing.list.description : input.description,
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

  async addItem(actor: ActorContext, listId: string, input: CreateListItem): Promise<ListView> {
    const list = await this.load(actor, listId);
    if (!list.list) {
      throw new WorkspaceError("NOT_FOUND", "List not found");
    }
    if (list.list.items.length >= WORKSPACE_LIMITS.listItemsMax) {
      throw new WorkspaceError("LIST_FULL", "List is full");
    }
    const nextPosition = list.list.items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    await this.db.workspaceListItem.create({
      data: {
        listObjectId: listId,
        text: input.text,
        position: nextPosition,
      },
    });
    await this.touch(listId);
    return this.get(actor, listId);
  }

  async updateItem(actor: ActorContext, listId: string, itemId: string, input: UpdateListItem): Promise<ListView> {
    const list = await this.load(actor, listId);
    const item = list.list?.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new WorkspaceError("NOT_FOUND", "List item not found");
    }
    const completedAt =
      input.completed === undefined ? item.completedAt : input.completed ? item.completedAt ?? new Date() : null;
    await this.db.workspaceListItem.update({
      where: { id: itemId },
      data: {
        text: input.text ?? item.text,
        completedAt: list.list?.type === "CHECKLIST" ? completedAt : null,
      },
    });
    await this.touch(listId);
    return this.get(actor, listId);
  }

  async deleteItem(actor: ActorContext, listId: string, itemId: string): Promise<ListView> {
    const list = await this.load(actor, listId);
    if (!list.list?.items.some((entry) => entry.id === itemId)) {
      throw new WorkspaceError("NOT_FOUND", "List item not found");
    }
    await this.db.workspaceListItem.delete({ where: { id: itemId } });
    await this.touch(listId);
    return this.get(actor, listId);
  }

  async reorder(actor: ActorContext, listId: string, input: ReorderListItems): Promise<ListView> {
    const list = await this.load(actor, listId);
    assertReorderIds(
      (list.list?.items ?? []).map((item) => item.id),
      input.itemIds,
    );
    if (isPrismaClient(this.db)) {
      await this.db.$transaction(
        input.itemIds.map((itemId, index) =>
          this.db.workspaceListItem.update({
            where: { id: itemId },
            data: { position: index },
          }),
        ),
      );
    } else {
      await Promise.all(
        input.itemIds.map((itemId, index) =>
          this.db.workspaceListItem.update({
            where: { id: itemId },
            data: { position: index },
          }),
        ),
      );
    }
    await this.touch(listId);
    return this.get(actor, listId);
  }

  private async touch(id: string): Promise<void> {
    await this.db.workspaceObject.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  private async load(actor: ActorContext, id: string) {
    const row = await this.db.workspaceObject.findFirst({
      where: { id, personalOwnerUserId: actor.userId, kind: "LIST", deletedAt: null },
      include: listInclude,
    });
    if (!row) {
      throw new WorkspaceError("NOT_FOUND", "List not found");
    }
    return row;
  }
}

function isPrismaClient(db: DbClient): db is PrismaClient {
  return "$transaction" in db;
}
