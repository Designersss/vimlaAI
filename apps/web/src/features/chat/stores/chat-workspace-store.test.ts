import { describe, expect, it } from "vitest";
import type { ChatMessage, DirectConversationSummary } from "@vimla/contracts";
import { ChatWorkspaceStore } from "./chat-workspace-store";

const history: ChatMessage[] = [{
  id: "saved", role: "USER", content: "Saved message", status: "COMPLETE", createdAt: "2026-09-14T00:00:00Z", mentions: [],
}];

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
    const lateDelta = (text: string): void => a.appendAssistantDelta(text);
    b.beginUserMessage("B question");
    b.appendAssistantDelta("B answer");
    lateDelta("A answer");
    a.finishAssistant();
    expect(a.messages.at(-1)).toMatchObject({ content: "A answer", status: "COMPLETE" });
    expect(b.messages.at(-1)).toMatchObject({ content: "B answer", status: "STREAMING" });
    expect(b.streaming).toBe(true);
    b.failAssistant("rate_limited");
    expect(a.error).toBeNull();
    expect(b.messages.at(-1)?.status).toBe("FAILED");
  });

  it("does not overwrite a pending or just-completed send with an older detail response", () => {
    const state = new ChatWorkspaceStore().conversation("a");
    const revisionAtFetch = state.revision;
    state.beginUserMessage("New message");
    const revisionDuringStream = state.revision;
    state.setMessages(history, state.revision);
    expect(state.messages[0]?.content).toBe("New message");
    state.appendAssistantDelta("New answer");
    state.finishAssistant();
    state.setMessages(history, revisionAtFetch);
    expect(state.messages.at(-1)?.content).toBe("New answer");
    state.setMessages(history, revisionDuringStream);
    expect(state.messages.at(-1)?.content).toBe("New answer");
    state.setMessages(history, state.revision);
    expect(state.messages).toEqual(history);
  });

  it("creating another chat preserves existing state, and a new workspace has no previous user's drafts", () => {
    const workspace = new ChatWorkspaceStore();
    workspace.conversation("a").setDraft("Private draft");
    workspace.conversation("a").setMessages(history, 0);
    workspace.addConversation({ id: "b", title: "B", updatedAt: history[0]!.createdAt });
    workspace.addConversation({ id: "b", title: "Updated B", updatedAt: history[0]!.createdAt });
    expect(workspace.conversations).toHaveLength(1);
    expect(workspace.conversation("a").messages).toEqual(history);
    expect(workspace.conversation("a").draft).toBe("Private draft");
    expect(new ChatWorkspaceStore().conversation("a").draft).toBe("");
  });

  it("keeps a newer read response when a cold direct-chat list arrives late", () => {
    const workspace = new ChatWorkspaceStore();
    const unread: DirectConversationSummary = {
      id: "a",
      peer: { userId: "peer", name: "Peer", email: "peer@example.com" },
      lastMessageAt: history[0]!.createdAt,
      createdAt: history[0]!.createdAt,
      unreadCount: 1,
      lastKind: "HUMAN",
      lastSenderUserId: "peer",
      privacy: {
        shareOwnHistoryWithVimla: false,
        includePeerHistoryWhenInvoking: false,
        peerShareOwnHistoryWithVimla: false,
      },
    };
    workspace.updateDirectConversation({ ...unread, unreadCount: 0 });
    workspace.hydrateDirectConversations([unread, { ...unread, id: "b" }]);
    expect(workspace.directConversations.map(({ id, unreadCount }) => ({ id, unreadCount })))
      .toEqual([{ id: "a", unreadCount: 0 }, { id: "b", unreadCount: 1 }]);
  });
});
