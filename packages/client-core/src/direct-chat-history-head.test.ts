import { describe, expect, it } from "vitest";
import { advanceDirectHistoryHead, reconcileDirectHistoryHead } from "./direct-chat-history-head.js";

describe("Direct causal head after acknowledged sends", () => {
  it("advances the head when a send confirms a newer database event", () => {
    expect(advanceDirectHistoryHead("5", "6")).toBe("6");
    expect(advanceDirectHistoryHead("0", "1")).toBe("1");
  });

  it("never rewinds an already newer realtime or sync head", () => {
    expect(advanceDirectHistoryHead("12", "11")).toBe("12");
    expect(advanceDirectHistoryHead("12", "12")).toBe("12");
  });

  it("preserves exact bigint ordering beyond safe JS numbers", () => {
    expect(advanceDirectHistoryHead(
      "9007199254740993", "9007199254740994",
    )).toBe("9007199254740994");
  });

  it("reconciles stale HTTP details without rolling the head backwards", () => {
    const current = { id: "chat-a", lastMessageSequence: "41", blockedByMe: false };
    const older = { id: "chat-a", lastMessageSequence: "39", blockedByMe: true };
    expect(reconcileDirectHistoryHead(current, older)).toEqual({
      id: "chat-a", lastMessageSequence: "41", blockedByMe: true,
    });
    expect(reconcileDirectHistoryHead(current, {
      id: "chat-a", lastMessageSequence: "42", blockedByMe: false,
    }).lastMessageSequence).toBe("42");
  });

  it("never imports another conversation's stream position", () => {
    expect(reconcileDirectHistoryHead(
      { id: "chat-a", lastMessageSequence: "900" },
      { id: "chat-b", lastMessageSequence: "3" },
    )).toEqual({ id: "chat-b", lastMessageSequence: "3" });
  });

  it("rejects noncanonical, negative or overflowing cursors", () => {
    for (const invalid of ["", "-1", "01", "NaN", "9223372036854775808"]) {
      expect(() => advanceDirectHistoryHead("1", invalid)).toThrow();
    }
  });
});
