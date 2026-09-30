import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REALTIME_PROTOCOL_VERSION,
  directMessageChangedRealtimeEventSchema,
  realtimeClientFrameSchema,
  realtimeServerFrameSchema,
} from "./realtime.js";

describe("realtime contracts", () => {
  it("accepts a strict versioned durable Direct Chat hint", () => {
    const conversationId = randomUUID();
    const event = {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "EVENT",
      eventId: randomUUID(),
      eventType: "DIRECT_MESSAGE_CHANGED",
      durability: "DURABLE_HINT",
      scope: {
        kind: "DIRECT_CHAT",
        id: conversationId,
      },
      occurredAt: new Date().toISOString(),
      payload: {
        conversationId,
        messageId: randomUUID(),
      },
    } as const;

    expect(
      directMessageChangedRealtimeEventSchema.parse(event),
    ).toEqual(event);
    expect(realtimeServerFrameSchema.parse(event)).toEqual(
      event,
    );
  });

  it("rejects scope/payload mismatches", () => {
    expect(
      directMessageChangedRealtimeEventSchema.safeParse({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "EVENT",
        eventId: randomUUID(),
        eventType: "DIRECT_MESSAGE_CHANGED",
        durability: "DURABLE_HINT",
        scope: {
          kind: "DIRECT_CHAT",
          id: randomUUID(),
        },
        occurredAt: new Date().toISOString(),
        payload: {
          conversationId: randomUUID(),
          messageId: randomUUID(),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown protocol versions and authority-like fields", () => {
    const conversationId = randomUUID();
    expect(
      realtimeServerFrameSchema.safeParse({
        protocolVersion: 2,
        frameType: "EVENT",
        eventId: randomUUID(),
        eventType: "DIRECT_MESSAGE_CHANGED",
        durability: "DURABLE_HINT",
        scope: {
          kind: "DIRECT_CHAT",
          id: conversationId,
        },
        occurredAt: new Date().toISOString(),
        payload: {
          conversationId,
          messageId: randomUUID(),
          userId: "other-user",
          role: "ADMIN",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only strict PONG client frames", () => {
    const heartbeatId = randomUUID();
    expect(
      realtimeClientFrameSchema.parse({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "PONG",
        heartbeatId,
      }),
    ).toEqual({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "PONG",
      heartbeatId,
    });
    expect(
      realtimeClientFrameSchema.safeParse({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "SUBSCRIBE",
        topic: "user:anyone",
      }).success,
    ).toBe(false);
  });
});
