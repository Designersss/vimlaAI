import { describe, expect, it } from "vitest";
import { planReservationAllocations } from "./allocation.js";
import { rubToMicroRub } from "./money.js";
import type { LockedBucket } from "./types.js";

function bucket(
  id: string,
  type: "MONTHLY" | "TOPUP",
  total: bigint,
  expiresAt: Date | null,
  createdAt: Date,
): LockedBucket {
  return {
    id,
    type,
    totalMicroRub: total,
    spentMicroRub: 0n,
    reservedMicroRub: 0n,
    expiresAt,
    createdAt,
  };
}

describe("planReservationAllocations", () => {
  it("spends monthly before top-up across multiple buckets", () => {
    const monthly = bucket("m", "MONTHLY", rubToMicroRub(2n), new Date("2026-10-01"), new Date("2026-09-01"));
    const topup = bucket("t", "TOPUP", rubToMicroRub(10n), null, new Date("2026-09-01"));
    const plan = planReservationAllocations([topup, monthly], rubToMicroRub(5n));

    expect(plan).toEqual([
      { bucketId: "m", reservedMicroRub: rubToMicroRub(2n) },
      { bucketId: "t", reservedMicroRub: rubToMicroRub(3n) },
    ]);
  });

  it("returns null when usage is insufficient", () => {
    const monthly = bucket("m", "MONTHLY", rubToMicroRub(1n), new Date("2026-10-01"), new Date("2026-09-01"));
    expect(planReservationAllocations([monthly], rubToMicroRub(2n))).toBeNull();
  });
});
