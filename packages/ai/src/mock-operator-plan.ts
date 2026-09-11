const PLANNER_MARKER = "VIMLA_OPERATOR_PLANNER_V1";

const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function isOperatorPlannerPrompt(messages: ReadonlyArray<{ content: string }>): boolean {
  return messages.some((message) => message.content.includes(PLANNER_MARKER));
}

export function mockOperatorPlannerResponse(messages: ReadonlyArray<{ content: string }>): string {
  const joined = messages.map((message) => message.content).join("\n");
  const userText = extractSection(joined, "USER_REQUEST:", "WORKSPACE_SNAPSHOT:") ?? joined;
  const snapshot = extractSection(joined, "WORKSPACE_SNAPSHOT:") ?? "";
  const lower = userText.toLowerCase();

  if (shouldClarify(lower, snapshot)) {
    return JSON.stringify({
      intent: "clarify",
      userMessage: "I need a bit more detail before changing anything.",
      clarificationQuestion: "Which reminder should I reschedule?",
      commands: [],
    });
  }

  if (shouldRefuse(lower)) {
    return JSON.stringify({
      intent: "refuse",
      userMessage: "I can only help with personal tasks, reminders, notes, lists, and notification preferences.",
      clarificationQuestion: null,
      commands: [],
    });
  }

  if (isRescheduleIntent(lower)) {
    const reminderId = firstSnapshotId(snapshot, "reminders") ?? firstUuid(userText);
    if (!reminderId) {
      return JSON.stringify({
        intent: "clarify",
        userMessage: "I need a bit more detail before changing anything.",
        clarificationQuestion: "Which reminder should I reschedule?",
        commands: [],
      });
    }
    return JSON.stringify({
      intent: "act",
      userMessage: "I will move that reminder.",
      clarificationQuestion: null,
      commands: [{ tool: "reminders.update", args: { id: reminderId, scheduledAt: nextNoonIso() } }],
    });
  }

  const deleteId = firstSnapshotId(snapshot, detectDeleteKind(lower)) ?? firstUuid(userText);
  if (isDeleteIntent(lower) && deleteId) {
    const tool = `${detectDeleteKind(lower)}.delete`;
    return JSON.stringify({
      intent: "act",
      userMessage: "I can delete that after you confirm.",
      clarificationQuestion: null,
      commands: [{ tool, args: { id: deleteId } }],
    });
  }

  if (isPinIntent(lower)) {
    const noteId = firstSnapshotId(snapshot, "notes") ?? firstUuid(userText);
    if (noteId) {
      return JSON.stringify({
        intent: "act",
        userMessage: "I will pin that note.",
        clarificationQuestion: null,
        commands: [{ tool: "notes.pin", args: { id: noteId } }],
      });
    }
  }

  if (isListIntent(lower)) {
    const title = extractQuoted(userText) ?? extractAfterPhrase(userText, ["список", "list"]) ?? "Trip packing";
    const items = extractListItems(userText);
    return JSON.stringify({
      intent: "act",
      userMessage: `I will create the list «${title}».`,
      clarificationQuestion: null,
      commands: [{ tool: "lists.create", args: { type: "CHECKLIST", title, items } }],
    });
  }

  if (isReminderIntent(lower)) {
    const title = extractQuoted(userText) ?? extractAfterPhrase(userText, ["напоминание", "reminder"]) ?? "Reminder";
    const scheduledAt = nextNoonIso();
    return JSON.stringify({
      intent: "act",
      userMessage: `I will create the reminder «${title}».`,
      clarificationQuestion: null,
      commands: [{ tool: "reminders.create", args: { title, scheduledAt } }],
    });
  }

  if (isAssignTaskIntent(lower) || isTaskIntent(lower)) {
    const title = extractQuoted(userText) ?? extractTaskTitle(userText) ?? "New task";
    const assigneeHint = extractAssigneeHint(userText);
    return JSON.stringify({
      intent: "act",
      userMessage: `I will create the task «${title}».`,
      clarificationQuestion: null,
      commands: [
        {
          tool: "tasks.create",
          args: assigneeHint ? { title, assigneeHint } : { title },
        },
      ],
    });
  }

  return JSON.stringify({
    intent: "answer",
    userMessage: answerFor(userText),
    clarificationQuestion: null,
    commands: [],
  });
}

function extractSection(text: string, start: string, end?: string): string | null {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) {
    return null;
  }
  const from = startIndex + start.length;
  const endIndex = end ? text.indexOf(end, from) : -1;
  return (endIndex === -1 ? text.slice(from) : text.slice(from, endIndex)).trim();
}

function isRescheduleIntent(lower: string): boolean {
  return lower.includes("перенес") || lower.includes("reschedul") || lower.includes("перенеси");
}

function shouldClarify(lower: string, snapshot: string): boolean {
  if (!isRescheduleIntent(lower)) {
    return false;
  }
  return !firstUuid(lower) && !firstSnapshotId(snapshot, "reminders");
}

function shouldRefuse(lower: string): boolean {
  return (
    lower.includes("оплат") ||
    lower.includes("payment") ||
    lower.includes("подписк") ||
    lower.includes("password") ||
    lower.includes("парол") ||
    lower.includes("admin")
  );
}

function isDeleteIntent(lower: string): boolean {
  return lower.includes("удал") || lower.includes("delete") || lower.includes("remove");
}

function isPinIntent(lower: string): boolean {
  return lower.includes("закреп") || lower.includes("pin");
}

function isListIntent(lower: string): boolean {
  return lower.includes("список") || lower.includes("checklist") || /\blist\b/.test(lower);
}

function isReminderIntent(lower: string): boolean {
  return lower.includes("напоминан") || lower.includes("reminder");
}

function isAssignTaskIntent(lower: string): boolean {
  return lower.includes("поставь") || lower.includes("назнач") || lower.includes("assign");
}

function isTaskIntent(lower: string): boolean {
  return lower.includes("задач") || lower.includes("task") || lower.includes("создай") || lower.includes("create");
}

function extractAssigneeHint(value: string): string | undefined {
  const assign = value.match(/(?:поставь|назначь|assign)\s+(.+?)\s+(?:задач|(?:a\s+)?task)/i);
  const captured = assign?.[1]?.trim();
  if (!captured) {
    return undefined;
  }
  const cleaned = captured.replace(/^мне$|^себе$|^меня$|^me$|^myself$/i, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : undefined;
}

function answerFor(userText: string): string {
  if (/гран-при|grand prix|победи|who won/i.test(userText)) {
    return "I don't have a live sports feed in this phase, but I can help with tasks in this chat.";
  }
  return "I can help with that from this Direct Chat without changing workspace items.";
}

function detectDeleteKind(lower: string): "tasks" | "reminders" | "notes" | "lists" {
  if (lower.includes("напоминан") || lower.includes("reminder")) {
    return "reminders";
  }
  if (lower.includes("заметк") || lower.includes("note")) {
    return "notes";
  }
  if (lower.includes("список") || lower.includes("list")) {
    return "lists";
  }
  return "tasks";
}

function firstSnapshotId(snapshot: string, kind: "tasks" | "reminders" | "notes" | "lists"): string | null {
  const parsed = parseSnapshot(snapshot);
  const items = parsed?.[kind];
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const first = items[0];
  if (first && typeof first === "object" && first !== null && "id" in first && typeof first.id === "string") {
    return first.id;
  }
  return firstUuid(snapshot);
}

function parseSnapshot(snapshot: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstUuid(value: string): string | null {
  const match = value.match(uuidRe);
  return match?.[0] ?? null;
}

function extractQuoted(value: string): string | null {
  const match = value.match(/[«"]([^»"]+)[»"]/);
  const captured = match?.[1]?.trim();
  return captured && captured.length > 0 ? captured : null;
}

function extractAfterPhrase(value: string, phrases: string[]): string | null {
  const lower = value.toLowerCase();
  for (const phrase of phrases) {
    const index = lower.indexOf(phrase);
    if (index >= 0) {
      const rest = value.slice(index + phrase.length).replace(/^[:\s]+/, "").split(/[\n.]/)[0]?.trim();
      if (rest && rest.length > 0 && rest.length <= 80) {
        return rest;
      }
    }
  }
  return null;
}

function extractTaskTitle(value: string): string | null {
  const cleaned = value
    .replace(/@vimla/gi, "")
    .replace(/создай задачу/i, "")
    .replace(/create a task/i, "")
    .replace(/создай/i, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, 80);
}

function extractListItems(value: string): string[] {
  const items = value
    .split(/[,\n]/)
    .map((part) => part.replace(/^[-*]\s*/, "").trim())
    .filter((part) => part.length > 0 && part.length <= 80)
    .slice(0, 12);
  return items.length > 1 ? items.slice(1) : ["Passport", "Tickets", "Charger"];
}

function nextNoonIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(12, 0, 0, 0);
  return date.toISOString();
}
