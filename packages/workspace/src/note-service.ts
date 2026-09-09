import type { Prisma } from "@vimla/database";
import { WORKSPACE_LIMITS, type CreateNote, type NoteView, type UpdateNote } from "@vimla/contracts";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { WorkspaceError } from "./errors.js";
import type { ActorContext, DbClient, ListQuery, TrustedSourceContext } from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function assertNoteContentSize(content: string): void {
  if (content.length > WORKSPACE_LIMITS.noteContentMax) {
    throw new WorkspaceError("PAYLOAD_TOO_LARGE", "Note is too large");
  }
}

function toView(row: {
  id: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  note: { title: string; contentMarkdown: string; pinnedAt: Date | null } | null;
}): NoteView {
  if (!row.note) {
    throw new WorkspaceError("NOT_FOUND", "Note not found");
  }
  return {
    id: row.id,
    kind: "NOTE",
    title: row.note.title,
    contentMarkdown: row.note.contentMarkdown,
    pinnedAt: iso(row.note.pinnedAt),
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class NoteService {
  constructor(private readonly db: DbClient) {}

  async create(actor: ActorContext, input: CreateNote, source?: TrustedSourceContext): Promise<NoteView> {
    assertNoteContentSize(input.contentMarkdown);
    const created = await this.db.workspaceObject.create({
      data: {
        kind: "NOTE",
        scopeType: "PERSONAL",
        personalOwnerUserId: actor.userId,
        createdByUserId: actor.userId,
        sourceConversationId: source?.conversationId,
        sourceMessageId: source?.messageId,
        note: {
          create: {
            title: input.title,
            contentMarkdown: input.contentMarkdown,
          },
        },
      },
      include: { note: true },
    });
    return toView(created);
  }

  async get(actor: ActorContext, id: string): Promise<NoteView> {
    return toView(await this.load(actor, id));
  }

  async list(
    actor: ActorContext,
    query: ListQuery & { q?: string; pinned?: boolean },
  ): Promise<{ items: NoteView[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const search = query.q?.trim();
    const where: Prisma.WorkspaceObjectWhereInput = {
      personalOwnerUserId: actor.userId,
      kind: "NOTE",
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      note: {
        is: {
          ...(query.pinned ? { pinnedAt: { not: null } } : {}),
          ...(search
            ? {
                OR: [
                  { title: { contains: search, mode: "insensitive" } },
                  { contentMarkdown: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      },
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
      include: { note: true },
      orderBy: [{ note: { pinnedAt: { sort: "desc", nulls: "last" } } }, { updatedAt: "desc" }, { id: "desc" }],
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

  async update(actor: ActorContext, id: string, input: UpdateNote): Promise<NoteView> {
    const existing = await this.load(actor, id);
    if (!existing.note) {
      throw new WorkspaceError("NOT_FOUND", "Note not found");
    }
    if (input.contentMarkdown !== undefined) {
      assertNoteContentSize(input.contentMarkdown);
    }
    const now = new Date();
    await this.db.workspaceObject.update({
      where: { id },
      data: {
        archivedAt:
          input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null,
        note: {
          update: {
            title: input.title ?? existing.note.title,
            contentMarkdown: input.contentMarkdown ?? existing.note.contentMarkdown,
            pinnedAt: input.pinned === undefined ? existing.note.pinnedAt : input.pinned ? existing.note.pinnedAt ?? now : null,
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
      where: { id, personalOwnerUserId: actor.userId, kind: "NOTE", deletedAt: null },
      include: { note: true },
    });
    if (!row) {
      throw new WorkspaceError("NOT_FOUND", "Note not found");
    }
    return row;
  }
}
