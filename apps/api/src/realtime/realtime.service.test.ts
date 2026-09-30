import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REALTIME_PROTOCOL_VERSION,
  realtimeEventEnvelopeSchema,
} from "@vimla/contracts";
import { realtimeEventTelemetry } from "./realtime.service.js";

describe("realtime telemetry", () => {
  it("projects only non-content event metadata", () => {
    const conversationId = randomUUID();
    const event = realtimeEventEnvelopeSchema.parse({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "EVENT",
      eventId: randomUUID(),
      eventType: "DIRECT_MESSAGE_CREATED",
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
    });

    const telemetry = realtimeEventTelemetry(event);
    expect(telemetry).toEqual({
      eventId: event.eventId,
      eventType: "DIRECT_MESSAGE_CREATED",
      durability: "DURABLE_HINT",
      scopeKind: "DIRECT_CHAT",
    });
    expect("payload" in telemetry).toBe(false);
    expect("scope" in telemetry).toBe(false);
    expect(
      JSON.stringify(telemetry),
    ).not.toContain(conversationId);
  });
});
