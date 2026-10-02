import { z } from "zod";

export const NAVIGATION_TARGET_VERSION = 1 as const;

const version = z.literal(NAVIGATION_TARGET_VERSION);
const id = z.string().uuid();

const staticTarget = <K extends string>(kind: K) =>
  z.object({ version, kind: z.literal(kind) }).strict();

const entityTarget = <K extends string>(kind: K) =>
  z.object({ version, kind: z.literal(kind), id }).strict();

export const navigationTargetSchema = z.discriminatedUnion("kind", [
  staticTarget("TASKS"),
  entityTarget("TASK"),
  staticTarget("REMINDERS"),
  entityTarget("REMINDER"),
  staticTarget("NOTES"),
  entityTarget("NOTE"),
  staticTarget("LISTS"),
  entityTarget("LIST"),
  staticTarget("TODAY"),
  staticTarget("PROFILE"),
  entityTarget("CHAT"),
  staticTarget("NOTIFICATION_SETTINGS"),
]);

export type NavigationTarget = z.infer<typeof navigationTargetSchema>;
