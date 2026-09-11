import { z } from "zod";

export const WORKSPACE_LIMITS = {
  titleMin: 1,
  titleMax: 200,
  taskDescriptionMax: 4_000,
  reminderDescriptionMax: 4_000,
  listDescriptionMax: 2_000,
  listItemTextMax: 500,
  listItemsMax: 200,
  noteContentMax: 50_000,
  pageLimitDefault: 20,
  pageLimitMax: 50,
} as const;

export const workspaceObjectKindSchema = z.enum(["TASK", "REMINDER", "LIST", "NOTE"]);
export type WorkspaceObjectKind = z.infer<typeof workspaceObjectKindSchema>;

export const workspaceScopeTypeSchema = z.enum(["PERSONAL"]);
export type WorkspaceScopeType = z.infer<typeof workspaceScopeTypeSchema>;

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELED"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const reminderStatusSchema = z.enum(["PENDING", "CANCELED", "DELIVERED", "FAILED"]);
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

export const listTypeSchema = z.enum(["PLAIN", "CHECKLIST"]);
export type ListType = z.infer<typeof listTypeSchema>;

export function isIanaTimeZone(value: string): boolean {
  if (value.length < 1 || value.length > 64) {
    return false;
  }
  if (/^[+-]?\d/.test(value) || value.includes(" ")) {
    return false;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZoneSchema = z.string().refine(isIanaTimeZone, { message: "invalid_timezone" });

export const isoDateTimeSchema = z.string().datetime({ offset: true });

const forbiddenAuthorityFields = {
  userId: true,
  ownerId: true,
  ownerUserId: true,
  personalOwnerUserId: true,
  createdByUserId: true,
  scopeType: true,
  sourceConversationId: true,
  sourceMessageId: true,
  completedAt: true,
  deliveredAt: true,
  canceledAt: true,
} as const;

export const workspaceCursorPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(WORKSPACE_LIMITS.pageLimitMax).default(WORKSPACE_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
});

export const workspacePageMetaSchema = z.object({
  nextCursor: z.string().nullable(),
});

const titleSchema = z.string().trim().min(WORKSPACE_LIMITS.titleMin).max(WORKSPACE_LIMITS.titleMax);

export const createTaskSchema = z
  .object({
    title: titleSchema,
    description: z.string().trim().max(WORKSPACE_LIMITS.taskDescriptionMax).optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
  })
  .strict();
export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().trim().max(WORKSPACE_LIMITS.taskDescriptionMax).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdateTask = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = workspaceCursorPageSchema.extend({
  status: taskStatusSchema.optional(),
  dueFrom: isoDateTimeSchema.optional(),
  dueTo: isoDateTimeSchema.optional(),
  archived: z.enum(["true", "false"]).optional(),
});

export const taskViewSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("TASK"),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema.nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assignedByUserId: z.string().nullable(),
  assignedByName: z.string().nullable(),
});
export type TaskView = z.infer<typeof taskViewSchema>;

export const tasksResponseSchema = z.object({
  items: z.array(taskViewSchema),
  nextCursor: z.string().nullable(),
});
export type TasksResponse = z.infer<typeof tasksResponseSchema>;

export const createReminderSchema = z
  .object({
    title: titleSchema,
    description: z.string().trim().max(WORKSPACE_LIMITS.reminderDescriptionMax).optional(),
    scheduledAt: isoDateTimeSchema,
    timezone: ianaTimeZoneSchema.optional(),
    linkedTaskId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateReminder = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().trim().max(WORKSPACE_LIMITS.reminderDescriptionMax).nullable().optional(),
    scheduledAt: isoDateTimeSchema.optional(),
    timezone: ianaTimeZoneSchema.optional(),
    linkedTaskId: z.string().uuid().nullable().optional(),
    status: z.enum(["PENDING", "CANCELED"]).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdateReminder = z.infer<typeof updateReminderSchema>;

export const listRemindersQuerySchema = workspaceCursorPageSchema.extend({
  status: reminderStatusSchema.optional(),
  archived: z.enum(["true", "false"]).optional(),
});

export const listListsQuerySchema = workspaceCursorPageSchema.extend({
  archived: z.enum(["true", "false"]).optional(),
  type: listTypeSchema.optional(),
});

export const reminderViewSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("REMINDER"),
  title: z.string(),
  description: z.string().nullable(),
  scheduledAt: z.string(),
  timezone: z.string(),
  status: reminderStatusSchema,
  linkedTaskId: z.string().uuid().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReminderView = z.infer<typeof reminderViewSchema>;

export const remindersResponseSchema = z.object({
  items: z.array(reminderViewSchema),
  nextCursor: z.string().nullable(),
});
export type RemindersResponse = z.infer<typeof remindersResponseSchema>;

export const createListSchema = z
  .object({
    type: listTypeSchema,
    title: titleSchema,
    description: z.string().trim().max(WORKSPACE_LIMITS.listDescriptionMax).optional(),
  })
  .strict();
export type CreateList = z.infer<typeof createListSchema>;

export const updateListSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().trim().max(WORKSPACE_LIMITS.listDescriptionMax).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdateList = z.infer<typeof updateListSchema>;

export const createListItemSchema = z
  .object({
    text: z.string().trim().min(1).max(WORKSPACE_LIMITS.listItemTextMax),
  })
  .strict();
export type CreateListItem = z.infer<typeof createListItemSchema>;

export const updateListItemSchema = z
  .object({
    text: z.string().trim().min(1).max(WORKSPACE_LIMITS.listItemTextMax).optional(),
    completed: z.boolean().optional(),
  })
  .strict();
export type UpdateListItem = z.infer<typeof updateListItemSchema>;

export const reorderListItemsSchema = z
  .object({
    itemIds: z.array(z.string().uuid()).min(1).max(WORKSPACE_LIMITS.listItemsMax),
  })
  .strict();
export type ReorderListItems = z.infer<typeof reorderListItemsSchema>;

export const listItemViewSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  position: z.number().int(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ListItemView = z.infer<typeof listItemViewSchema>;

export const listViewSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("LIST"),
  type: listTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  items: z.array(listItemViewSchema),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ListView = z.infer<typeof listViewSchema>;

export const listsResponseSchema = z.object({
  items: z.array(listViewSchema),
  nextCursor: z.string().nullable(),
});
export type ListsResponse = z.infer<typeof listsResponseSchema>;

export const createNoteSchema = z
  .object({
    title: titleSchema,
    contentMarkdown: z.string().max(WORKSPACE_LIMITS.noteContentMax).default(""),
  })
  .strict();
export type CreateNote = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    title: titleSchema.optional(),
    contentMarkdown: z.string().max(WORKSPACE_LIMITS.noteContentMax).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdateNote = z.infer<typeof updateNoteSchema>;

export const listNotesQuerySchema = workspaceCursorPageSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  archived: z.enum(["true", "false"]).optional(),
  pinned: z.enum(["true", "false"]).optional(),
});

export const noteViewSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("NOTE"),
  title: z.string(),
  contentMarkdown: z.string(),
  pinnedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoteView = z.infer<typeof noteViewSchema>;

export const notesResponseSchema = z.object({
  items: z.array(noteViewSchema),
  nextCursor: z.string().nullable(),
});
export type NotesResponse = z.infer<typeof notesResponseSchema>;

export const workspaceTodayResponseSchema = z.object({
  timezone: z.string().nullable(),
  overdueTasks: z.array(taskViewSchema),
  todayTasks: z.array(taskViewSchema),
  todayReminders: z.array(reminderViewSchema),
  counts: z.object({
    overdueTasks: z.number().int(),
    todayTasks: z.number().int(),
    todayReminders: z.number().int(),
  }),
});
export type WorkspaceTodayResponse = z.infer<typeof workspaceTodayResponseSchema>;

export const forbiddenWorkspaceAuthorityKeys = Object.keys(forbiddenAuthorityFields);
