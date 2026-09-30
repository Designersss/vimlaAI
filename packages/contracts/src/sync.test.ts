import { describe, expect, it } from "vitest";
import {
  SYNC_PROTOCOL_VERSION,
  directMessageCreatedSyncDeltaSchema,
  directMessageDeletedSyncDeltaSchema,
  syncQuerySchema,
  syncResponseSchema,
} from "./sync.js";

describe("sync contracts", () => {
  it("requires canonical protocol version negotiation", () => {
    expect(
      syncQuerySchema.parse({
        protocolVersion: "1",
      }),
    ).toMatchObject({
      protocolVersion: "1",
      limit: 100,
    });
    expect(
      syncQuerySchema.safeParse({
        protocolVersion: "01",
      }).success,
    ).toBe(false);
    expect(
      syncQuerySchema.safeParse({
        protocolVersion: "2",
      }).success,
    ).toBe(false);
  });

  it("keeps created-message references identifier-only and internally consistent", () => {
    const conversationId =
      "11111111-1111-4111-8111-111111111111";
    const messageId =
      "22222222-2222-4222-8222-222222222222";
    expect(
      directMessageCreatedSyncDeltaSchema.parse({
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        eventId: messageId,
        eventType: "DIRECT_MESSAGE_CREATED",
        changeKind: "UPSERT_REF",
        scope: {
          kind: "DIRECT_CHAT",
          id: conversationId,
        },
        occurredAt:
          "2026-09-30T00:00:00.000Z",
        payload: {
          conversationId,
          messageId,
        },
      }),
    ).toBeDefined();

    expect(
      directMessageCreatedSyncDeltaSchema.safeParse({
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        eventId:
          "33333333-3333-4333-8333-333333333333",
        eventType: "DIRECT_MESSAGE_CREATED",
        changeKind: "UPSERT_REF",
        scope: {
          kind: "DIRECT_CHAT",
          id: conversationId,
        },
        occurredAt:
          "2026-09-30T00:00:00.000Z",
        payload: {
          conversationId,
          messageId,
          plaintext: "forbidden",
        },
      }).success,
    ).toBe(false);
  });

  it("uses a distinct event identity for tombstones while preserving the deleted resource id", () => {
    const conversationId =
      "11111111-1111-4111-8111-111111111111";
    const messageId =
      "22222222-2222-4222-8222-222222222222";
    const eventId =
      "33333333-3333-4333-8333-333333333333";
    const parsed =
      directMessageDeletedSyncDeltaSchema.parse({
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        eventId,
        eventType: "DIRECT_MESSAGE_DELETED",
        changeKind: "TOMBSTONE",
        scope: {
          kind: "DIRECT_CHAT",
          id: conversationId,
        },
        occurredAt:
          "2026-09-30T00:00:00.000Z",
        payload: {
          conversationId,
          messageId,
        },
      });
    expect(parsed.eventId).not.toBe(
      parsed.payload.messageId,
    );
  });

  it("bounds response size at the contract layer", () => {
    const cursor = "YQ.Yg";
    expect(
      syncResponseSchema.safeParse({
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        deltas: Array.from(
          { length: 201 },
          () => ({
            syncProtocolVersion:
              SYNC_PROTOCOL_VERSION,
            eventId:
              "22222222-2222-4222-8222-222222222222",
            eventType:
              "DIRECT_MESSAGE_CREATED",
            changeKind: "UPSERT_REF",
            scope: {
              kind: "DIRECT_CHAT",
              id: "11111111-1111-4111-8111-111111111111",
            },
            occurredAt:
              "2026-09-30T00:00:00.000Z",
            payload: {
              conversationId:
                "11111111-1111-4111-8111-111111111111",
              messageId:
                "22222222-2222-4222-8222-222222222222",
            },
          }),
        ),
        nextCursor: cursor,
        hasMore: false,
      }).success,
    ).toBe(false);
  });
});
