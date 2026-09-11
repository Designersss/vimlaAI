import { describe, expect, it } from "vitest";
import {
  activeMemberUserIds,
  lockedExternalProjectIds,
  lockedOwnedProjectIds,
  viewerAccessState,
} from "./ranking.js";

function project(id: string, opened: string | null, created: string) {
  return {
    id,
    lastOpenedAt: opened ? new Date(opened) : null,
    createdAt: new Date(created),
  };
}

describe("project entitlement ranking", () => {
  it("keeps the last opened owned project and locks the rest", () => {
    const owned = [
      project("a", "2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
      project("b", "2026-03-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z"),
      project("c", "2026-02-01T00:00:00.000Z", "2025-03-01T00:00:00.000Z"),
    ];
    const locked = lockedOwnedProjectIds(owned, { unlimited: false, value: 1n });
    expect(locked).toEqual(new Set(["a", "c"]));
  });

  it("does not use createdAt when lastOpenedAt is present", () => {
    const owned = [
      project("new", "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      project("old-opened", "2026-08-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"),
    ];
    const locked = lockedOwnedProjectIds(owned, { unlimited: false, value: 1n });
    expect(locked).toEqual(new Set(["new"]));
  });

  it("keeps the two last opened joined projects for a Free member", () => {
    const joined = [
      project("one", "2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
      project("two", "2026-03-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
      project("three", "2026-02-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"),
    ];
    const locked = lockedExternalProjectIds(joined, { unlimited: false, value: 2n });
    expect(locked).toEqual(new Set(["one"]));
  });

  it("falls back to createdAt when lastOpenedAt is missing", () => {
    const owned = [
      project("older", null, "2025-01-01T00:00:00.000Z"),
      project("newer", null, "2026-01-01T00:00:00.000Z"),
    ];
    expect(lockedOwnedProjectIds(owned, { unlimited: false, value: 1n })).toEqual(new Set(["older"]));
  });

  it("does not lock anything when the limit is unlimited", () => {
    const owned = [project("a", null, "2026-01-01T00:00:00.000Z"), project("b", null, "2026-02-01T00:00:00.000Z")];
    expect(lockedOwnedProjectIds(owned, { unlimited: true, value: 0n }).size).toBe(0);
  });

  it("keeps owner plus the last opened other member under the Free member cap", () => {
    const members = [
      {
        userId: "owner",
        role: "OWNER" as const,
        lastOpenedAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        userId: "old",
        role: "MEMBER" as const,
        lastOpenedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
      },
      {
        userId: "fresh",
        role: "ADMIN" as const,
        lastOpenedAt: new Date("2026-04-01T00:00:00.000Z"),
        createdAt: new Date("2025-03-01T00:00:00.000Z"),
      },
    ];
    expect(activeMemberUserIds(members, { unlimited: false, value: 2n })).toEqual(new Set(["owner", "fresh"]));
  });

  it("prefers project PLAN_LOCKED over member-plan locks", () => {
    expect(
      viewerAccessState({
        isOwner: false,
        projectLocked: true,
        memberLockedByOwnerPlan: true,
        memberLockedByMemberPlan: true,
      }),
    ).toBe("PLAN_LOCKED");
  });
});
