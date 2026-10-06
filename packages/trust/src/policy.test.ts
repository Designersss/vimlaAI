import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vimla/database";
import { PrismaUserTrustPolicy } from "./policy.js";

describe("PrismaUserTrustPolicy", () => {
  it("filters only the bounded discovery candidates in both block directions", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        blockerUserId: "actor",
        blockedUserId: "blocked",
      },
      {
        blockerUserId: "blocker",
        blockedUserId: "actor",
      },
    ]);
    const db = {
      userBlock: { findMany },
    } as unknown as PrismaClient;
    const policy = new PrismaUserTrustPolicy(db);

    await expect(
      policy.filterDiscoverableUserIds("actor", [
        "actor",
        "allowed",
        "blocked",
        "blocker",
        "allowed",
      ]),
    ).resolves.toEqual(["actor", "allowed"]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            blockerUserId: "actor",
            blockedUserId: {
              in: ["allowed", "blocked", "blocker"],
            },
          },
          {
            blockedUserId: "actor",
            blockerUserId: {
              in: ["allowed", "blocked", "blocker"],
            },
          },
        ],
      },
      select: {
        blockerUserId: true,
        blockedUserId: true,
      },
    });
  });

  it("keeps discovery and interaction bidirectionally blocked without treating self as blocked", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "block-id" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "owned-block" })
      .mockResolvedValueOnce(null);
    const db = {
      userBlock: { findFirst },
    } as unknown as PrismaClient;
    const policy = new PrismaUserTrustPolicy(db);

    await expect(
      policy.canDiscover("actor", "peer"),
    ).resolves.toBe(false);
    await expect(
      policy.canInteract("actor", "other"),
    ).resolves.toBe(true);
    await expect(
      policy.hasBlocked("actor", "peer"),
    ).resolves.toBe(true);
    await expect(
      policy.hasBlocked("actor", "other"),
    ).resolves.toBe(false);
    await expect(
      policy.canInteract("actor", "actor"),
    ).resolves.toBe(true);
    await expect(
      policy.hasBlocked("actor", "actor"),
    ).resolves.toBe(false);
  });
});
