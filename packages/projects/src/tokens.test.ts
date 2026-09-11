import { describe, expect, it } from "vitest";
import { hashInviteToken, inviteTokensEqual, normalizeInviteEmail } from "./tokens.js";

describe("project invite tokens", () => {
  it("normalizes invite emails and hashes tokens with HMAC", () => {
    expect(normalizeInviteEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    const hash = hashInviteToken("secret-token", "server-secret");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("secret-token");
    expect(inviteTokensEqual(hash, hashInviteToken("secret-token", "server-secret"))).toBe(true);
    expect(inviteTokensEqual(hash, hashInviteToken("other-token", "server-secret"))).toBe(false);
  });
});
