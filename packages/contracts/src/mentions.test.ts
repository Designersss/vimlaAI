import { describe, expect, it } from "vitest";
import {
  mentionSuggestionsQuerySchema,
  mentionSuggestionsResponseSchema,
} from "./mentions.js";

describe("mention suggestion contracts", () => {
  it("normalizes typed @ queries without changing context", () => {
    expect(
      mentionSuggestionsQuerySchema.parse({
        q: "@De",
        conversationId: "conversation-1",
      }),
    ).toEqual({
      q: "de",
      conversationId: "conversation-1",
    });
  });

  it("rejects ambiguous multi-surface context", () => {
    const result = mentionSuggestionsQuerySchema.safeParse({
      projectId: "project-1",
      directConversationId: "direct-1",
    });
    expect(result.success).toBe(false);
  });

  it("parses presentation-safe sectioned candidates", () => {
    expect(
      mentionSuggestionsResponseSchema.parse({
        people: [
          {
            id: "handle-user-1",
            kind: "USER",
            handle: "denis",
            label: "Denis",
            description: null,
            avatarUrl: null,
            role: "MEMBER",
          },
        ],
        vimla: [
          {
            id: "handle-vimla",
            kind: "SYSTEM_AGENT",
            handle: "vimla",
            label: "Vimla",
            description: null,
            avatarUrl: null,
            role: null,
          },
        ],
        ai: [
          {
            id: "handle-auto",
            kind: "AI_AUTO",
            handle: "auto",
            label: "Auto",
            description: null,
            avatarUrl: null,
            role: null,
          },
        ],
      }).ai[0]?.handle,
    ).toBe("auto");
  });
});
