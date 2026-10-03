import { z } from "zod";
import { clientInstallationIdSchema } from "./client-installations.js";

export const REALTIME_PROTOCOL_VERSION = 1 as const;

export const realtimeDurabilitySchema = z.enum([
  "DURABLE_HINT",
  "EPHEMERAL",
]);
export type RealtimeDurability = z.infer<
  typeof realtimeDurabilitySchema
>;

export const realtimeEventTypeSchema = z.enum([
  "DIRECT_MESSAGE_CREATED",
  "DIRECT_READ_UPDATED",
]);
export type RealtimeEventType = z.infer<
  typeof realtimeEventTypeSchema
>;

export const realtimeScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DIRECT_CHAT"),
      id: z.string().uuid(),
    })
    .strict(),
]);
export type RealtimeScope = z.infer<typeof realtimeScopeSchema>;

export const directMessageCreatedRealtimePayloadSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  })
  .strict();
export type DirectMessageCreatedRealtimePayload = z.infer<
  typeof directMessageCreatedRealtimePayloadSchema
>;

export const directMessageCreatedRealtimeEventSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("EVENT"),
    eventId: z.string().uuid(),
    eventType: z.literal("DIRECT_MESSAGE_CREATED"),
    durability: z.literal("DURABLE_HINT"),
    scope: z
      .object({
        kind: z.literal("DIRECT_CHAT"),
        id: z.string().uuid(),
      })
      .strict(),
    occurredAt: z.string().datetime({ offset: true }),
    payload: directMessageCreatedRealtimePayloadSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope.id !== value.payload.conversationId) {
      ctx.addIssue({
        code: "custom",
        path: ["scope", "id"],
        message:
          "Realtime scope id must match Direct Chat conversation id",
      });
    }
  });

export const directReadUpdatedRealtimePayloadSchema = z
  .object({
    conversationId: z.string().uuid(),
  })
  .strict();
export type DirectReadUpdatedRealtimePayload = z.infer<
  typeof directReadUpdatedRealtimePayloadSchema
>;

export const directReadUpdatedRealtimeEventSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("EVENT"),
    eventId: z.string().uuid(),
    eventType: z.literal("DIRECT_READ_UPDATED"),
    durability: z.literal("DURABLE_HINT"),
    scope: z
      .object({
        kind: z.literal("DIRECT_CHAT"),
        id: z.string().uuid(),
      })
      .strict(),
    occurredAt: z.string().datetime({ offset: true }),
    payload: directReadUpdatedRealtimePayloadSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope.id !== value.payload.conversationId) {
      ctx.addIssue({
        code: "custom",
        path: ["scope", "id"],
        message:
          "Realtime scope id must match Direct Chat conversation id",
      });
    }
  });

export const realtimeEventEnvelopeSchema = z.discriminatedUnion(
  "eventType",
  [
    directMessageCreatedRealtimeEventSchema,
    directReadUpdatedRealtimeEventSchema,
  ],
);
export type RealtimeEventEnvelope = z.infer<
  typeof realtimeEventEnvelopeSchema
>;

export const realtimeHelloFrameSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("HELLO"),
    connectionId: z.string().uuid(),
    installationId: clientInstallationIdSchema,
    heartbeatIntervalMs: z
      .number()
      .int()
      .min(1)
      .max(120_000),
    serverTime: z.string().datetime({ offset: true }),
  })
  .strict();
export type RealtimeHelloFrame = z.infer<
  typeof realtimeHelloFrameSchema
>;

export const realtimeHeartbeatFrameSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("HEARTBEAT"),
    heartbeatId: z.string().uuid(),
    sentAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RealtimeHeartbeatFrame = z.infer<
  typeof realtimeHeartbeatFrameSchema
>;

export const realtimeServerFrameSchema = z.discriminatedUnion(
  "frameType",
  [
    realtimeHelloFrameSchema,
    realtimeHeartbeatFrameSchema,
    realtimeEventEnvelopeSchema,
  ],
);
export type RealtimeServerFrame = z.infer<
  typeof realtimeServerFrameSchema
>;

export const realtimePongFrameSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("PONG"),
    heartbeatId: z.string().uuid(),
  })
  .strict();

export const realtimeClientFrameSchema =
  realtimePongFrameSchema;
export type RealtimeClientFrame = z.infer<
  typeof realtimeClientFrameSchema
>;
