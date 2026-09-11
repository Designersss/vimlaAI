import { z } from "zod";
import {
  createListItemSchema,
  createListSchema,
  createNoteSchema,
  createReminderSchema,
  createTaskSchema,
  updateListSchema,
  updateNoteSchema,
  updateNotificationPreferencesSchema,
  updateReminderSchema,
  updateTaskSchema,
  WORKSPACE_LIMITS,
} from "@vimla/contracts";

const objectIdSchema = z.string().uuid();
const emptyArgsSchema = z.object({}).strict();

export const operatorToolNames = [
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "reminders.list",
  "reminders.get",
  "reminders.create",
  "reminders.update",
  "reminders.delete",
  "notes.list",
  "notes.get",
  "notes.create",
  "notes.update",
  "notes.pin",
  "notes.delete",
  "lists.list",
  "lists.get",
  "lists.create",
  "lists.update",
  "lists.addItem",
  "lists.delete",
  "today.get",
  "profile.getSafe",
  "notifications.getPreferences",
  "notifications.updatePreferences",
] as const;

export type OperatorToolName = (typeof operatorToolNames)[number];

export const operatorToolInputSchemas = {
  "tasks.list": z
    .object({
      status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELED"]).optional(),
    })
    .strict(),
  "tasks.get": z.object({ id: objectIdSchema }).strict(),
  "tasks.create": createTaskSchema.extend({
    assigneeHint: z.string().trim().min(1).max(120).optional(),
  }),
  "tasks.update": z
    .object({
      id: objectIdSchema,
      title: updateTaskSchema.shape.title,
      description: updateTaskSchema.shape.description,
      status: updateTaskSchema.shape.status,
      priority: updateTaskSchema.shape.priority,
      dueAt: updateTaskSchema.shape.dueAt,
      archived: updateTaskSchema.shape.archived,
    })
    .strict(),
  "tasks.delete": z.object({ id: objectIdSchema }).strict(),
  "reminders.list": z
    .object({
      status: z.enum(["PENDING", "CANCELED", "DELIVERED", "FAILED"]).optional(),
    })
    .strict(),
  "reminders.get": z.object({ id: objectIdSchema }).strict(),
  "reminders.create": createReminderSchema,
  "reminders.update": z
    .object({
      id: objectIdSchema,
      title: updateReminderSchema.shape.title,
      description: updateReminderSchema.shape.description,
      scheduledAt: updateReminderSchema.shape.scheduledAt,
      timezone: updateReminderSchema.shape.timezone,
      linkedTaskId: updateReminderSchema.shape.linkedTaskId,
      status: updateReminderSchema.shape.status,
      archived: updateReminderSchema.shape.archived,
    })
    .strict(),
  "reminders.delete": z.object({ id: objectIdSchema }).strict(),
  "notes.list": z
    .object({
      q: z.string().trim().min(1).max(200).optional(),
      pinned: z.boolean().optional(),
    })
    .strict(),
  "notes.get": z.object({ id: objectIdSchema }).strict(),
  "notes.create": createNoteSchema,
  "notes.update": z
    .object({
      id: objectIdSchema,
      title: updateNoteSchema.shape.title,
      contentMarkdown: updateNoteSchema.shape.contentMarkdown,
      pinned: updateNoteSchema.shape.pinned,
      archived: updateNoteSchema.shape.archived,
    })
    .strict(),
  "notes.pin": z.object({ id: objectIdSchema }).strict(),
  "notes.delete": z.object({ id: objectIdSchema }).strict(),
  "lists.list": emptyArgsSchema,
  "lists.get": z.object({ id: objectIdSchema }).strict(),
  "lists.create": z
    .object({
      type: createListSchema.shape.type,
      title: createListSchema.shape.title,
      description: createListSchema.shape.description,
      items: z
        .array(z.string().trim().min(1).max(WORKSPACE_LIMITS.listItemTextMax))
        .max(WORKSPACE_LIMITS.listItemsMax)
        .optional(),
    })
    .strict(),
  "lists.update": z
    .object({
      id: objectIdSchema,
      title: updateListSchema.shape.title,
      description: updateListSchema.shape.description,
      archived: updateListSchema.shape.archived,
    })
    .strict(),
  "lists.addItem": z
    .object({
      listId: objectIdSchema,
      text: createListItemSchema.shape.text,
    })
    .strict(),
  "lists.delete": z.object({ id: objectIdSchema }).strict(),
  "today.get": emptyArgsSchema,
  "profile.getSafe": emptyArgsSchema,
  "notifications.getPreferences": emptyArgsSchema,
  "notifications.updatePreferences": updateNotificationPreferencesSchema,
} as const;

export const plannerCommandSchema = z
  .object({
    tool: z.enum(operatorToolNames),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

export const plannerOutputSchema = z
  .object({
    intent: z.enum(["act", "clarify", "refuse", "answer"]),
    userMessage: z.string().trim().min(1).max(2_000),
    clarificationQuestion: z.string().trim().min(1).max(500).nullable().optional(),
    commands: z.array(plannerCommandSchema).max(8),
  })
  .strict();

export const DENIED_TOOL_NAMES = [
  "prisma",
  "sql",
  "redis",
  "shell",
  "fs",
  "env",
  "http",
  "admin",
  "payment",
  "subscription",
  "password",
  "email.change",
  "mfa",
] as const;
