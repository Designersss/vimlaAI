import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vimla/database";
import { PrismaUserTrustPolicy } from "./policy.js";

describe("PrismaUserTrustPolicy", () => {
  it("excludes both directions of a block from discovery", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        blockerUserId: "actor",
        blockedUserId: "blocked",
      },
      {
        blockerUserId: "blocker",
        blockedUserId: "actor",
      },
      {
        blockerUserId: "actor",
        blockedUserId: "blocked",
      },
    ]);
    const db = {
      userBlock: { findMany },
    } as unknown as PrismaClient;
    const policy = new PrismaUserTrustPolicy(db);

    await expect(
      policy.excludedDiscoveryUserIds("actor"),
    ).resolves.toEqual(["blocked", "blocker"]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerUserId: "actor" },
          { blockedUserId: "actor" },
        ],
      },
      select: {
        blockerUserId: true,
        blockedUserId: true,
      },
    });
  });

  it("allows self operations but denies peer interaction when either direction is blocked", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "block-id" })
      .mockResolvedValueOnce(null);
    const db = {
      userBlock: { findFirst },
    } as unknown as PrismaClient;
    const policy = new PrismaUserTrustPolicy(db);

    await expect(
      policy.canInteract("actor", "actor"),
    ).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();

    await expect(
      policy.canInteract("actor", "peer"),
    ).resolves.toBe(false);
    await expect(
      policy.canInteract("actor", "other"),
    ).resolves.toBe(true);

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          {
            blockerUserId: "actor",
            blockedUserId: "peer",
          },
          {
            blockerUserId: "peer",
            blockedUserId: "actor",
          },
        ],
      },
      select: { id: true },
    });
  });
});
