import type { NavigationTarget, OperatorActionCard, OperatorActionKind } from "@vimla/contracts";
import { WorkspaceError } from "@vimla/workspace";
import { NotificationPlatformError } from "@vimla/notifications";
import { OperatorError } from "./errors.js";
import { evaluatePlanPolicy, isRegisteredTool, parseToolArgs, toolRequiresConfirmation } from "./policy.js";
import { OPERATOR_RUNTIME_LIMITS } from "./limits.js";
import { sanitizePublicText } from "./public-text.js";
import type { OperatorToolName } from "./tools/schemas.js";
import type { OperatorToolContext, ParsedCommand, PreparedStep, ToolHandlerResult } from "./types.js";

function titleOf(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return sanitizePublicText(value, 200) || fallback;
  }
  return fallback;
}

function card(
  kind: OperatorActionKind,
  operation: OperatorActionCard["operation"],
  title: string,
  detail: string | null,
  navigationTarget: NavigationTarget,
  status: OperatorActionCard["status"] = "success",
): OperatorActionCard {
  return { kind, operation, title, detail, status, navigationTarget };
}

export function prepareSteps(
  commands: readonly ParsedCommand[],
  invocationScope: "PERSONAL" | "DIRECT_CHAT" = "PERSONAL",
): PreparedStep[] {
  evaluatePlanPolicy(
    commands,
    OPERATOR_RUNTIME_LIMITS.maxToolsPerRun,
    invocationScope,
  );
  return commands.map((command, index) => {
    if (!isRegisteredTool(command.tool)) {
      throw new OperatorError("TOOL_DENIED", "Unknown operator tool");
    }
    const args = parseToolArgs(command.tool, command.args);
    const preview = previewCard(command.tool, args);
    return {
      sequence: index,
      toolName: command.tool,
      args,
      confirmationRequired: toolRequiresConfirmation(command.tool, args),
      card: {
        ...preview.card,
        status: toolRequiresConfirmation(command.tool, args) ? "pending_confirmation" : "success",
      },
      idempotencyKey: `${index}:${command.tool}`,
    };
  });
}

export async function executeStep(
  toolName: string,
  args: Record<string, unknown>,
  context: OperatorToolContext,
): Promise<ToolHandlerResult> {
  if (!isRegisteredTool(toolName)) {
    throw new OperatorError("TOOL_DENIED", "Unknown operator tool");
  }
  const parsed = parseToolArgs(toolName, args);
  try {
    return await dispatch(toolName, parsed, context);
  } catch (error: unknown) {
    if (error instanceof OperatorError || error instanceof WorkspaceError || error instanceof NotificationPlatformError) {
      throw error;
    }
    throw new OperatorError("VALIDATION_ERROR", "Tool execution failed");
  }
}

function previewCard(tool: OperatorToolName, args: Record<string, unknown>): ToolHandlerResult {
  const targetFor = (kind: OperatorActionKind, id?: unknown): NavigationTarget => {
    if (kind === "task") {
      return typeof id === "string"
        ? { version: 1, kind: "TASK", id }
        : { version: 1, kind: "TASKS" };
    }
    if (kind === "reminder") {
      return typeof id === "string"
        ? { version: 1, kind: "REMINDER", id }
        : { version: 1, kind: "REMINDERS" };
    }
    if (kind === "note") {
      return typeof id === "string"
        ? { version: 1, kind: "NOTE", id }
        : { version: 1, kind: "NOTES" };
    }
    if (kind === "list") {
      return typeof id === "string"
        ? { version: 1, kind: "LIST", id }
        : { version: 1, kind: "LISTS" };
    }
    if (kind === "notifications") {
      return { version: 1, kind: "NOTIFICATION_SETTINGS" };
    }
    if (kind === "profile") {
      return { version: 1, kind: "PROFILE" };
    }
    if (kind === "today") {
      return { version: 1, kind: "TODAY" };
    }
    const exhaustive: never = kind;
    throw new OperatorError("TOOL_DENIED", `Unhandled action kind ${String(exhaustive)}`);
  };

  switch (tool) {
    case "tasks.create":
      return { card: card("task", "created", titleOf(args.title, "Task"), null, targetFor("task")), objectId: null };
    case "tasks.update":
      return { card: card("task", "updated", titleOf(args.title, "Task"), null, targetFor("task")), objectId: String(args.id) };
    case "tasks.delete":
      return { card: card("task", "deleted", "Task", null, targetFor("task"), "pending_confirmation"), objectId: String(args.id) };
    case "tasks.get":
    case "tasks.list":
      return { card: card("task", tool === "tasks.get" ? "read" : "listed", "Tasks", null, targetFor("task")), objectId: null };
    case "reminders.create":
      return { card: card("reminder", "created", titleOf(args.title, "Reminder"), null, targetFor("reminder")), objectId: null };
    case "reminders.update":
      return { card: card("reminder", "updated", titleOf(args.title, "Reminder"), null, targetFor("reminder")), objectId: String(args.id) };
    case "reminders.delete":
      return { card: card("reminder", "deleted", "Reminder", null, targetFor("reminder"), "pending_confirmation"), objectId: String(args.id) };
    case "reminders.get":
    case "reminders.list":
      return { card: card("reminder", tool === "reminders.get" ? "read" : "listed", "Reminders", null, targetFor("reminder")), objectId: null };
    case "notes.create":
      return { card: card("note", "created", titleOf(args.title, "Note"), null, targetFor("note")), objectId: null };
    case "notes.update":
      return { card: card("note", "updated", titleOf(args.title, "Note"), null, targetFor("note", args.id)), objectId: String(args.id) };
    case "notes.pin":
      return { card: card("note", "pinned", "Note", null, targetFor("note", args.id)), objectId: String(args.id) };
    case "notes.delete":
      return { card: card("note", "deleted", "Note", null, targetFor("note"), "pending_confirmation"), objectId: String(args.id) };
    case "notes.get":
    case "notes.list":
      return { card: card("note", tool === "notes.get" ? "read" : "listed", "Notes", null, tool === "notes.get" ? targetFor("note", args.id) : targetFor("note")), objectId: null };
    case "lists.create":
      return { card: card("list", "created", titleOf(args.title, "List"), null, targetFor("list")), objectId: null };
    case "lists.update":
      return { card: card("list", "updated", titleOf(args.title, "List"), null, targetFor("list", args.id)), objectId: String(args.id) };
    case "lists.addItem":
      return { card: card("list", "item_added", titleOf(args.text, "Item"), null, targetFor("list", args.listId)), objectId: String(args.listId) };
    case "lists.delete":
      return { card: card("list", "deleted", "List", null, targetFor("list"), "pending_confirmation"), objectId: String(args.id) };
    case "lists.get":
    case "lists.list":
      return { card: card("list", tool === "lists.get" ? "read" : "listed", "Lists", null, tool === "lists.get" ? targetFor("list", args.id) : targetFor("list")), objectId: null };
    case "today.get":
      return { card: card("today", "read", "Today", null, targetFor("today")), objectId: null };
    case "profile.getSafe":
      return { card: card("profile", "read", "Profile", null, targetFor("profile")), objectId: null };
    case "notifications.getPreferences":
      return { card: card("notifications", "read", "Notifications", null, targetFor("notifications")), objectId: null };
    case "notifications.updatePreferences":
      return {
        card: card("notifications", "updated", "Notifications", null, targetFor("notifications"), "pending_confirmation"),
        objectId: null,
      };
    default: {
      const exhaustive: never = tool;
      throw new OperatorError("TOOL_DENIED", `Unhandled tool ${String(exhaustive)}`);
    }
  }
}

async function dispatch(
  tool: OperatorToolName,
  args: Record<string, unknown>,
  context: OperatorToolContext,
): Promise<ToolHandlerResult> {
  const actor = context.actor;
  const source = context.source;
  const listQuery = { limit: 20 };

  switch (tool) {
    case "tasks.list": {
      const page = await context.services.tasks.list(actor, {
        ...listQuery,
        status: args.status as "TODO" | "IN_PROGRESS" | "DONE" | "CANCELED" | undefined,
      });
      return {
        card: card("task", "listed", "Tasks", String(page.items.length), targetFor("task")),
        objectId: null,
      };
    }
    case "tasks.get": {
      const task = await context.services.tasks.get(actor, String(args.id));
      return { card: card("task", "read", task.title, null, targetFor("task", task.id)), objectId: task.id };
    }
    case "tasks.create": {
      const hint = optionalString(args.assigneeHint);
      const resolved = context.invocation.resolveTaskOwner(hint);
      if (resolved.type === "clarify") {
        throw new OperatorError("CLARIFICATION_REQUIRED", resolved.question);
      }
      if (resolved.type === "deny") {
        throw new OperatorError("TOOL_DENIED", resolved.message);
      }
      const created = await context.services.tasks.create(
        actor,
        {
          title: String(args.title),
          description: optionalString(args.description),
          status: args.status as "TODO" | "IN_PROGRESS" | "CANCELED" | undefined,
          priority: args.priority as "LOW" | "NORMAL" | "HIGH" | null | undefined,
          dueAt: optionalString(args.dueAt),
        },
        source,
        {
          ownerUserId: resolved.ownerUserId,
          assignedByUserId: resolved.assignedByUserId,
          assignmentSourceType: resolved.assignmentSourceType,
          assignmentSourceId: resolved.assignmentSourceId,
        },
      );
      const detail = resolved.assignedByUserId ? "Assigned from Direct Chat" : null;
      return { card: card("task", "created", created.title, detail, targetFor("task", created.id)), objectId: created.id };
    }
    case "tasks.update": {
      const updated = await context.services.tasks.update(actor, String(args.id), {
        title: optionalString(args.title),
        description: optionalNullableString(args.description),
        status: args.status as "TODO" | "IN_PROGRESS" | "DONE" | "CANCELED" | undefined,
        priority: args.priority as "LOW" | "NORMAL" | "HIGH" | null | undefined,
        dueAt: optionalNullableString(args.dueAt),
        archived: optionalBoolean(args.archived),
      });
      return { card: card("task", "updated", updated.title, null, targetFor("task", updated.id)), objectId: updated.id };
    }
    case "tasks.delete": {
      await context.services.tasks.delete(actor, String(args.id));
      return { card: card("task", "deleted", "Task", null, targetFor("task")), objectId: String(args.id) };
    }
    case "reminders.list": {
      const page = await context.services.reminders.list(actor, {
        ...listQuery,
        status: args.status as "PENDING" | "CANCELED" | "DELIVERED" | "FAILED" | undefined,
      });
      return { card: card("reminder", "listed", "Reminders", String(page.items.length), targetFor("reminder")), objectId: null };
    }
    case "reminders.get": {
      const reminder = await context.services.reminders.get(actor, String(args.id));
      return { card: card("reminder", "read", reminder.title, null, targetFor("reminder", reminder.id)), objectId: reminder.id };
    }
    case "reminders.create": {
      const timezone = optionalString(args.timezone) ?? context.timezone;
      if (!timezone) {
        throw new OperatorError("VALIDATION_ERROR", "Timezone is required");
      }
      const created = await context.services.reminders.create(
        actor,
        {
          title: String(args.title),
          description: optionalString(args.description),
          scheduledAt: String(args.scheduledAt),
          timezone,
          linkedTaskId: optionalNullableString(args.linkedTaskId),
        },
        { timezone, source },
      );
      return { card: card("reminder", "created", created.title, null, targetFor("reminder", created.id)), objectId: created.id };
    }
    case "reminders.update": {
      const updated = await context.services.reminders.update(actor, String(args.id), {
        title: optionalString(args.title),
        description: optionalNullableString(args.description),
        scheduledAt: optionalString(args.scheduledAt),
        timezone: optionalString(args.timezone),
        linkedTaskId: optionalNullableString(args.linkedTaskId),
        status: args.status as "PENDING" | "CANCELED" | undefined,
        archived: optionalBoolean(args.archived),
      });
      return { card: card("reminder", "updated", updated.title, null, targetFor("reminder", updated.id)), objectId: updated.id };
    }
    case "reminders.delete": {
      await context.services.reminders.delete(actor, String(args.id));
      return { card: card("reminder", "deleted", "Reminder", null, targetFor("reminder")), objectId: String(args.id) };
    }
    case "notes.list": {
      const page = await context.services.notes.list(actor, {
        ...listQuery,
        q: optionalString(args.q),
        pinned: optionalBoolean(args.pinned),
      });
      return { card: card("note", "listed", "Notes", String(page.items.length), targetFor("note")), objectId: null };
    }
    case "notes.get": {
      const note = await context.services.notes.get(actor, String(args.id));
      return { card: card("note", "read", note.title, null, targetFor("note", note.id)), objectId: note.id };
    }
    case "notes.create": {
      const created = await context.services.notes.create(
        actor,
        {
          title: String(args.title),
          contentMarkdown: optionalString(args.contentMarkdown) ?? "",
        },
        source,
      );
      return { card: card("note", "created", created.title, null, targetFor("note", created.id)), objectId: created.id };
    }
    case "notes.update": {
      const updated = await context.services.notes.update(actor, String(args.id), {
        title: optionalString(args.title),
        contentMarkdown: optionalString(args.contentMarkdown),
        pinned: optionalBoolean(args.pinned),
        archived: optionalBoolean(args.archived),
      });
      return { card: card("note", "updated", updated.title, null, targetFor("note", updated.id)), objectId: updated.id };
    }
    case "notes.pin": {
      const updated = await context.services.notes.update(actor, String(args.id), { pinned: true });
      return { card: card("note", "pinned", updated.title, null, targetFor("note", updated.id)), objectId: updated.id };
    }
    case "notes.delete": {
      await context.services.notes.delete(actor, String(args.id));
      return { card: card("note", "deleted", "Note", null, targetFor("note")), objectId: String(args.id) };
    }
    case "lists.list": {
      const page = await context.services.lists.list(actor, listQuery);
      return { card: card("list", "listed", "Lists", String(page.items.length), targetFor("list")), objectId: null };
    }
    case "lists.get": {
      const list = await context.services.lists.get(actor, String(args.id));
      return { card: card("list", "read", list.title, null, targetFor("list", list.id)), objectId: list.id };
    }
    case "lists.create": {
      const created = await context.services.lists.create(
        actor,
        {
          type: args.type === "CHECKLIST" ? "CHECKLIST" : "PLAIN",
          title: String(args.title),
          description: optionalString(args.description),
        },
        source,
      );
      const items = Array.isArray(args.items) ? args.items.filter((item): item is string => typeof item === "string") : [];
      let current = created;
      for (const text of items) {
        current = await context.services.lists.addItem(actor, created.id, { text });
      }
      return { card: card("list", "created", current.title, null, targetFor("list", current.id)), objectId: current.id };
    }
    case "lists.update": {
      const updated = await context.services.lists.update(actor, String(args.id), {
        title: optionalString(args.title),
        description: optionalNullableString(args.description),
        archived: optionalBoolean(args.archived),
      });
      return { card: card("list", "updated", updated.title, null, targetFor("list", updated.id)), objectId: updated.id };
    }
    case "lists.addItem": {
      const updated = await context.services.lists.addItem(actor, String(args.listId), { text: String(args.text) });
      return { card: card("list", "item_added", updated.title, titleOf(args.text, "Item"), targetFor("list", updated.id)), objectId: updated.id };
    }
    case "lists.delete": {
      await context.services.lists.delete(actor, String(args.id));
      return { card: card("list", "deleted", "List", null, targetFor("list")), objectId: String(args.id) };
    }
    case "today.get": {
      const today = await context.services.today.get(actor, context.timezone, context.now);
      return {
        card: card("today", "read", "Today", String(today.counts.todayTasks + today.counts.todayReminders), targetFor("today")),
        objectId: null,
      };
    }
    case "profile.getSafe": {
      const profile = await context.services.getSafeProfile(actor.userId);
      return { card: card("profile", "read", profile.name, profile.timezone, targetFor("profile")), objectId: null };
    }
    case "notifications.getPreferences": {
      await context.services.notifications.get(actor.userId);
      return {
        card: card("notifications", "read", "Notifications", null, targetFor("notifications")),
        objectId: null,
      };
    }
    case "notifications.updatePreferences": {
      await context.services.notifications.update(
        actor.userId,
        {
          reminderInAppEnabled: optionalBoolean(args.reminderInAppEnabled),
          reminderEmailEnabled: optionalBoolean(args.reminderEmailEnabled),
        },
        context.defaultLocale,
      );
      return {
        card: card("notifications", "updated", "Notifications", null, targetFor("notifications")),
        objectId: null,
      };
    }
    default: {
      const exhaustive: never = tool;
      throw new OperatorError("TOOL_DENIED", `Unhandled tool ${String(exhaustive)}`);
    }
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
