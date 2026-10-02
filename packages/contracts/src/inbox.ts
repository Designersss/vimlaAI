import { z } from "zod";
import { communicationSurfaceKindSchema } from "./communication-surfaces.js";
import { directMessageKindSchema } from "./direct-chats.js";
import { NAVIGATION_TARGET_VERSION } from "./navigation.js";

export const INBOX_LIMITS = {
  pageDefault: 50,
  pageMax: 100,
  searchMax: 120,
  serverPreviewMax: 280,
  cursorMax: 512,
} as const;

export const listInboxQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(INBOX_LIMITS.pageMax)
      .default(INBOX_LIMITS.pageDefault),
    cursor: z.string().min(1).max(INBOX_LIMITS.cursorMax).optional(),
    kind: communicationSurfaceKindSchema.optional(),
    q: z.string().trim().min(1).max(INBOX_LIMITS.searchMax).optional(),
  })
  .strict();
export type ListInboxQuery = z.infer<typeof listInboxQuerySchema>;

export const inboxNavigationTargetSchema = z
  .object({
    version: z.literal(NAVIGATION_TARGET_VERSION),
    kind: z.literal("CHAT"),
    id: z.string().uuid(),
  })
  .strict();

export const inboxPeerSummarySchema = z
  .object({
    userId: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    avatarUrl: z.string().max(2_048).nullable(),
  })
  .strict();
export type InboxPeerSummary = z.infer<typeof inboxPeerSummarySchema>;

export const inboxEmptyPreviewSchema = z
  .object({
    kind: z.literal("NONE"),
  })
  .strict();

export const inboxServerTextPreviewSchema = z
  .object({
    kind: z.literal("SERVER_TEXT"),
    messageId: z.string().min(1).max(128),
    role: z.enum(["USER", "ASSISTANT"]),
    text: z.string().max(INBOX_LIMITS.serverPreviewMax),
  })
  .strict();

export const inboxE2eeLocalPreviewSchema = z
  .object({
    kind: z.literal("E2EE_LOCAL"),
    messageId: z.string().uuid(),
    senderUserId: z.string().min(1).max(128),
    messageKind: directMessageKindSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const aiThreadInboxItemSchema = z
  .object({
    surfaceId: z.string().uuid(),
    surfaceKind: z.literal("AI_THREAD"),
    domainId: z.string().min(1).max(128),
    title: z.string().max(200).nullable(),
    peer: z.null(),
    lastActivityAt: z.string().datetime({ offset: true }),
    unreadCount: z.literal(0),
    preview: z.union([
      inboxEmptyPreviewSchema,
      inboxServerTextPreviewSchema,
    ]),
    navigationTarget: inboxNavigationTargetSchema,
  })
  .strict();

export const directInboxItemSchema = z
  .object({
    surfaceId: z.string().uuid(),
    surfaceKind: z.literal("DIRECT"),
    domainId: z.string().uuid(),
    title: z.string().min(1).max(200),
    peer: inboxPeerSummarySchema,
    lastActivityAt: z.string().datetime({ offset: true }),
    unreadCount: z.number().int().min(0),
    preview: z.union([
      inboxEmptyPreviewSchema,
      inboxE2eeLocalPreviewSchema,
    ]),
    navigationTarget: inboxNavigationTargetSchema,
  })
  .strict();

export const inboxItemSchema = z.discriminatedUnion("surfaceKind", [
  aiThreadInboxItemSchema,
  directInboxItemSchema,
]);
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const inboxResponseSchema = z
  .object({
    items: z.array(inboxItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type InboxResponse = z.infer<typeof inboxResponseSchema>;
