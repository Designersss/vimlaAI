import { z } from "zod";
import { clientInstallationIdSchema } from "./client-installations.js";

export const REALTIME_PROTOCOL_VERSION = 1 as const;

export const REALTIME_LIMITS = {
  frameBytesMax: 8_192,
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 60_000,
  maxConnectionsPerInstallation: 8,
} as const;

export const realtimeDurabilitySchema = z.enum([
  "DURABLE_HINT",
  "EPHEMERAL",
]);
export type RealtimeDurability = z.infer<
  typeof realtimeDurabilitySchema
>;

export const realtimeEventTypeSchema = z.enum([
  "DIRECT_MESSAGE_CHANGED",
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

export const directMessageChangedRealtimePayloadSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  })
  .strict();
export type DirectMessageChangedRealtimePayload = z.infer<
  typeof directMessageChangedRealtimePayloadSchema
>;

export const directMessageChangedRealtimeEventSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    frameType: z.literal("EVENT"),
    eventId: z.string().uuid(),
    eventType: z.literal("DIRECT_MESSAGE_CHANGED"),
    durability: z.literal("DURABLE_HINT"),
    scope: z
      .object({
        kind: z.literal("DIRECT_CHAT"),
        id: z.string().uuid(),
      })
      .strict(),
    occurredAt: z.string().datetime({ offset: true }),
    payload: directMessageChangedRealtimePayloadSchema,
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

export const realtimeEventEnvelopeSchema =
  directMessageChangedRealtimeEventSchema;
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
