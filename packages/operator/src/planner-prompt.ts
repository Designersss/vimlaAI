import { PLANNER_MARKER } from "./limits.js";
import { operatorToolNames } from "./tools/schemas.js";
import type { WorkspaceSnapshot } from "./types.js";

const TOOL_HELP: Record<(typeof operatorToolNames)[number], string> = {
  "tasks.list": "List the user's personal tasks. Optional status filter.",
  "tasks.get": "Get one personal task by id from the snapshot.",
  "tasks.create": "Create a personal task. dueAt must be an ISO timestamp.",
  "tasks.update": "Update a personal task the user owns.",
  "tasks.delete": "Soft-delete a personal task. Destructive; requires confirmation.",
  "reminders.list": "List personal reminders.",
  "reminders.get": "Get one personal reminder by id.",
  "reminders.create": "Create a reminder. scheduledAt is ISO UTC. Use the user timezone when provided.",
  "reminders.update": "Update a reminder. Canceling requires confirmation.",
  "reminders.delete": "Soft-delete a reminder. Destructive; requires confirmation.",
  "notes.list": "List personal notes. Optional title/content query.",
  "notes.get": "Get one personal note by id.",
  "notes.create": "Create a personal note.",
  "notes.update": "Update a personal note.",
  "notes.pin": "Pin a personal note.",
  "notes.delete": "Soft-delete a note. Destructive; requires confirmation.",
  "lists.list": "List personal lists.",
  "lists.get": "Get one personal list by id, including items.",
  "lists.create": "Create a PLAIN or CHECKLIST list. Optional items[] of strings.",
  "lists.update": "Update list title/description.",
  "lists.addItem": "Add an item to a list.",
  "lists.delete": "Soft-delete a list. Destructive; requires confirmation.",
  "today.get": "Get today's tasks and reminders in the user timezone.",
  "profile.getSafe": "Read safe profile fields only: name, locale, timezone, emailVerified. Never email or credentials.",
  "notifications.getPreferences": "Read reminder in-app/email preference flags. No email address.",
  "notifications.updatePreferences": "Update reminder channel preferences. Requires confirmation.",
};

export function buildPlannerPrompt(input: {
  userText: string;
  locale: string;
  snapshot: WorkspaceSnapshot;
  previousClarification?: string | null;
}): string {
  const catalog = operatorToolNames.map((name) => `- ${name}: ${TOOL_HELP[name]}`).join("\n");
  const snapshot = JSON.stringify(
    {
      timezone: input.snapshot.timezone,
      locale: input.snapshot.locale,
      tasks: input.snapshot.tasks,
      reminders: input.snapshot.reminders,
      notes: input.snapshot.notes,
      lists: input.snapshot.lists,
    },
    null,
    2,
  );

  return [
    PLANNER_MARKER,
    "You are the internal planner for the Vimla operator.",
    "Reply with a single JSON object. No markdown, no extra text.",
    "JSON shape: {\"intent\":\"act\"|\"clarify\"|\"refuse\",\"userMessage\":\"...\",\"clarificationQuestion\":null,\"commands\":[{\"tool\":\"tasks.create\",\"args\":{}}]}",
    "Rules:",
    "- Never invent userId, permissions, prices, model IDs, or owner fields.",
    "- Never call tools that are not listed.",
    "- Use object ids only from WORKSPACE_SNAPSHOT or USER_REQUEST.",
    "- If the target object is ambiguous or missing, intent=clarify and commands=[].",
    "- Refuse payments, admin, email/password/MFA, projects, and external HTTP.",
    "- userMessage is shown to the user. Do not include raw ids or tool JSON.",
    "- Destructive deletes require commands; the server will ask for confirmation.",
    `Locale: ${input.locale}`,
    "Tools:",
    catalog,
    input.previousClarification ? `PREVIOUS_CLARIFICATION:\n${input.previousClarification}` : "",
    "USER_REQUEST:",
    input.userText,
    "WORKSPACE_SNAPSHOT:",
    snapshot,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
