import { OPERATOR_RUNTIME_LIMITS } from "./limits.js";
import type { OperatorToolContext, WorkspaceSnapshot } from "./types.js";

export async function loadWorkspaceSnapshot(context: OperatorToolContext): Promise<WorkspaceSnapshot> {
  const limit = OPERATOR_RUNTIME_LIMITS.snapshotItems;
  const [tasks, reminders, notes, lists] = await Promise.all([
    context.services.tasks.list(context.actor, { limit }),
    context.services.reminders.list(context.actor, { limit }),
    context.services.notes.list(context.actor, { limit }),
    context.services.lists.list(context.actor, { limit }),
  ]);

  return {
    timezone: context.timezone,
    locale: context.locale,
    tasks: tasks.items.map((item) => ({ id: item.id, kind: "TASK" as const, title: item.title })),
    reminders: reminders.items.map((item) => ({ id: item.id, kind: "REMINDER" as const, title: item.title })),
    notes: notes.items.map((item) => ({ id: item.id, kind: "NOTE" as const, title: item.title })),
    lists: lists.items.map((item) => ({ id: item.id, kind: "LIST" as const, title: item.title })),
  };
}
