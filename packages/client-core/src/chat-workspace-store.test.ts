import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  InboxItem,
} from "@vimla/contracts";
import { ChatWorkspaceStore } from "./chat-workspace-store.js";

const historyCreatedAt =
  "2026-09-14T00:00:00Z";
const history: ChatMessage[] = [
  {
    id: "saved",
    role: "USER",
    content: "Saved message",
    status: "COMPLETE",
    createdAt: historyCreatedAt,
    mentions: [],
  },
];

function aiInboxItem(
  surfaceId: string,
  domainId: string,
  lastActivityAt: string,
): InboxItem {
  return {
    surfaceId,
    surfaceKind: "AI_THREAD",
    domainId,
    title: domainId,
    peer: null,
    lastActivityAt,
    unreadCount: 0,
    preview: { kind: "NONE" },
    navigationTarget: {
      version: 1,
      kind: "CHAT",
      id: surfaceId,
    },
  };
}

describe("persistent chat workspace", () => {
  it("isolates drafts, messages and late stream callbacks by conversation without selecting a route", () => {
    const workspace = new ChatWorkspaceStore();
    const a = workspace.conversation("a");
    a.setDraft("A draft");
    const b = workspace.conversation("b");
    b.setMessages(history, b.revision);
    b.setDraft("B draft");
    expect(workspace.conversation("a")).toBe(a);
    expect(a.draft).toBe("A draft");
    a.beginUserMessage("A question");
    const lateDelta = (text: string): void =>
      a.appendAssistantDelta(text);
    b.beginUserMessage("B question");
    b.appendAssistantDelta("B answer");
    lateDelta("A answer");
    a.finishAssistant();
    expect(a.messages.at(-1)).toMatchObject({
      content: "A answer",
      status: "COMPLETE",
    });
    expect(b.messages.at(-1)).toMatchObject({
      content: "B answer",
      status: "STREAMING",
    });
    expect(b.streaming).toBe(true);
    b.failAssistant("rate_limited");
    expect(a.error).toBeNull();
    expect(b.messages.at(-1)?.status).toBe(
      "FAILED",
    );
  });

  it("does not overwrite a pending or just-completed send with an older detail response", () => {
    const state =
      new ChatWorkspaceStore().conversation("a");
    const revisionAtFetch = state.revision;
    state.beginUserMessage("New message");
    const revisionDuringStream = state.revision;
    state.setMessages(history, state.revision);
    expect(state.messages[0]?.content).toBe(
      "New message",
    );
    state.appendAssistantDelta("New answer");
    state.finishAssistant();
    state.setMessages(history, revisionAtFetch);
    expect(
      state.messages.at(-1)?.content,
    ).toBe("New answer");
    state.setMessages(
      history,
      revisionDuringStream,
    );
    expect(
      state.messages.at(-1)?.content,
    ).toBe("New answer");
    state.setMessages(history, state.revision);
    expect(state.messages).toEqual(history);
  });

  it("keeps detail state independent from unified inbox refreshes", () => {
    const workspace = new ChatWorkspaceStore();
    workspace.conversation("a").setDraft(
      "Private draft",
    );
    workspace
      .conversation("a")
      .setMessages(history, 0);

    workspace.setInboxPage({
      items: [
        aiInboxItem(
          "11111111-1111-4111-8111-111111111111",
          "b",
          "2026-09-14T12:00:00Z",
        ),
      ],
      nextCursor: null,
    });
    workspace.setInboxPage({
      items: [
        aiInboxItem(
          "22222222-2222-4222-8222-222222222222",
          "c",
          "2026-09-14T13:00:00Z",
        ),
      ],
      nextCursor: null,
    });

    expect(
      workspace.inboxItems.map(
        (item) => item.domainId,
      ),
    ).toEqual(["c"]);
    expect(
      workspace.conversation("a").messages,
    ).toEqual(history);
    expect(
      workspace.conversation("a").draft,
    ).toBe("Private draft");
    expect(
      new ChatWorkspaceStore().conversation("a")
        .draft,
    ).toBe("");
  });

  it("preserves server ordering while appending paginated inbox results without duplicates", () => {
    const workspace = new ChatWorkspaceStore();
    const first = aiInboxItem(
      "33333333-3333-4333-8333-333333333333",
      "first",
      "2026-09-14T13:00:00Z",
    );
    const second = aiInboxItem(
      "44444444-4444-4444-8444-444444444444",
      "second",
      "2026-09-14T12:00:00Z",
    );

    workspace.setInboxPage({
      items: [first],
      nextCursor: "page-2",
    });
    workspace.setInboxPage(
      {
        items: [first, second],
        nextCursor: null,
      },
      true,
    );

    expect(
      workspace.inboxItems.map(
        (item) => item.domainId,
      ),
    ).toEqual(["first", "second"]);
    expect(workspace.inboxNextCursor).toBeNull();
  });
});
