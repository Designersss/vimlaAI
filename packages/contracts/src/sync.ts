import { z } from "zod";

export const SYNC_PROTOCOL_VERSION = 1 as const;

export const SYNC_LIMITS = {
  defaultPageSize: 100,
  maxPageSize: 200,
  maxScanPerPage: 500,
  maxCursorBytes: 512,
} as const;

export const syncCursorSchema = z
  .string()
  .min(1)
  .max(SYNC_LIMITS.maxCursorBytes)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const syncQuerySchema = z
  .object({
    cursor: syncCursorSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SYNC_LIMITS.maxPageSize)
      .default(SYNC_LIMITS.defaultPageSize),
  })
  .strict();

export const syncChangeKindSchema = z.enum([
  "UPSERT_REF",
  "TOMBSTONE",
]);

export const syncScopeSchema = z
  .object({
    kind: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    id: z.string().min(1).max(128),
  })
  .strict();

const syncBaseDeltaSchema = z.object({
  syncProtocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  eventId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

export const directMessageCreatedSyncDeltaSchema =
  syncBaseDeltaSchema
    .extend({
      eventType: z.literal("DIRECT_MESSAGE_CREATED"),
      changeKind: z.literal("UPSERT_REF"),
      scope: z
        .object({
          kind: z.literal("DIRECT_CHAT"),
          id: z.uuid(),
        })
        .strict(),
      payload: z
        .object({
          conversationId: z.uuid(),
          messageId: z.uuid(),
        })
        .strict(),
    })
    .strict()
    .refine(
      (value) =>
        value.scope.id === value.payload.conversationId &&
        value.eventId === value.payload.messageId,
      "Direct message sync delta identifiers must match",
    );

export const directMessageDeletedSyncDeltaSchema =
  syncBaseDeltaSchema
    .extend({
      eventType: z.literal("DIRECT_MESSAGE_DELETED"),
      changeKind: z.literal("TOMBSTONE"),
      scope: z
        .object({
          kind: z.literal("DIRECT_CHAT"),
          id: z.uuid(),
        })
        .strict(),
      payload: z
        .object({
          conversationId: z.uuid(),
          messageId: z.uuid(),
        })
        .strict(),
    })
    .strict()
    .refine(
      (value) =>
        value.scope.id === value.payload.conversationId &&
        value.eventId === value.payload.messageId,
      "Direct message tombstone identifiers must match",
    );

export const syncDeltaSchema = z.union([
  directMessageCreatedSyncDeltaSchema,
  directMessageDeletedSyncDeltaSchema,
]);
export type SyncDelta = z.infer<typeof syncDeltaSchema>;

export const syncResponseSchema = z
  .object({
    syncProtocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
    deltas: z.array(syncDeltaSchema).max(SYNC_LIMITS.maxPageSize),
    nextCursor: syncCursorSchema,
    hasMore: z.boolean(),
  })
  .strict();

export type SyncResponse = z.infer<typeof syncResponseSchema>;
