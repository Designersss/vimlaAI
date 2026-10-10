import { describe, expect, it } from "vitest";
import type { DirectMessageView, DirectReactionEventsResponse } from "@vimla/contracts";
import { validateDirectReactionLookupPage } from "./direct-chat-reaction-history-lookup.js";

const tag = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const request = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  targetTagB64: tag,
  sourceSequence: "1",
  limit: 2,
};

function event(id: string, sequence: string): DirectMessageView {
  return {
    id, conversationId: request.conversationId, senderUserId: "alice",
    senderDeviceId: request.deviceId, clientMessageId: id,
    contentCommitmentB64: tag, reactionTargetTagB64: tag,
    kind: "REACTION", interactionEpoch: 0, sequence,
    createdAt: "2026-10-09T10:00:00.000Z", envelope: null, mentions: [],
  };
}

function page(...items: DirectMessageView[]): DirectReactionEventsResponse {
  return { items, nextCursor: null };
}

describe("bounded opaque E2EE reaction index responses", () => {
  it("accepts ordered device-scoped encrypted controls but makes no completeness claim", () => {
    const result = page(event("a", "5"), event("b", "3"));
    expect(validateDirectReactionLookupPage(result, request)).toBe(result);
    expect(validateDirectReactionLookupPage(
      { items: [event("a", "5"), event("b", "3")], nextCursor: "czE6Mw" }, request,
    ).items).toHaveLength(2);
  });

  it("rejects foreign tag, conversation, device envelope or human kind", () => {
    const original = event("a", "5");
    const invalid = [
      { ...original, conversationId: "other" },
      { ...original, reactionTargetTagB64: "different" },
      { ...original, kind: "HUMAN" as const },
      {
        ...original,
        envelope: {
          recipientDeviceId: "foreign-device",
          headerB64: "a", ciphertextB64: "b", dhPublicB64: "c",
          messageNumber: 0, previousChainLength: 0,
          senderSignatureB64: "d", x3dhInit: null,
        },
      },
    ];
    for (const candidate of invalid) {
      expect(() => validateDirectReactionLookupPage(page(candidate), request))
        .toThrow("Conflicting or out-of-scope");
    }
  });

  it("rejects reordered, repeated, out-of-bounds and partial cursor pages", () => {
    const invalid: DirectReactionEventsResponse[] = [
      page(event("a", "2"), event("b", "3")),
      page(event("a", "3"), event("a", "2")),
      page(event("a", "3"), event("b", "3")),
      page(event("a", "1")),
      page(event("a", "-2")),
      page(event("a", "9223372036854775808")),
      page(event("a", "7"), event("b", "6"), event("c", "5")),
      { items: [event("a", "3")], nextCursor: "cursor" },
    ];
    for (const candidate of invalid) {
      expect(() => validateDirectReactionLookupPage(candidate, request)).toThrow();
    }
    expect(() => validateDirectReactionLookupPage(page(event("a", "5")), {
      ...request, sourceSequence: "not-canonical",
    })).toThrow("Invalid E2EE");
  });

  it("binds a pagination cursor to the exact last returned sequence and rejects rewinds or leaps", () => {
    const items = [event("a", "9223372036854775807"), event("b", "3")];
    const valid = { items, nextCursor: "czE6Mw" };
    expect(validateDirectReactionLookupPage(valid, request)).toBe(valid);
    for (const cursor of [
      "czE6NQ", // Canonical s1:5: repeat the first event, not the page boundary
      "czE6Mg", // Canonical s1:2: skip events below the boundary
      "czE6Mw==", // Invalid padded representation
      "safecursor",
      "czI6Mw", // Unknown cursor version
      "",
    ]) {
      expect(() => validateDirectReactionLookupPage(
        { items, nextCursor: cursor }, request,
      )).toThrow();
    }
  });

  it("rejects oversized hostile sequence data before arbitrary BigInt parsing", () => {
    expect(() => validateDirectReactionLookupPage(page(
      event("a", "9".repeat(50000)),
    ), request)).toThrow("Invalid encrypted reaction sequence");
  });
});
