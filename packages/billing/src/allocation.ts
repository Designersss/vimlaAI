import { availableMicroRub, type MicroRub } from "./money.js";
import type { LockedBucket, ReservationAllocationPlan, UsageBucketType } from "./types.js";

export function compareBucketPriority(left: LockedBucket, right: LockedBucket): number {
  const leftRank = bucketTypeRank(left.type);
  const rightRank = bucketTypeRank(right.type);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (left.expiresAt && right.expiresAt) {
    const byExpiry = left.expiresAt.getTime() - right.expiresAt.getTime();
    if (byExpiry !== 0) {
      return byExpiry;
    }
  } else if (left.expiresAt && !right.expiresAt) {
    return -1;
  } else if (!left.expiresAt && right.expiresAt) {
    return 1;
  }

  return left.createdAt.getTime() - right.createdAt.getTime();
}

export function planReservationAllocations(
  buckets: readonly LockedBucket[],
  estimatedMicroRub: MicroRub,
): ReservationAllocationPlan[] | null {
  if (estimatedMicroRub <= 0n) {
    return null;
  }

  const ordered = [...buckets].sort(compareBucketPriority);
  const allocations: ReservationAllocationPlan[] = [];
  let remaining = estimatedMicroRub;

  for (const bucket of ordered) {
    if (remaining === 0n) {
      break;
    }

    const available = availableMicroRub(
      bucket.totalMicroRub,
      bucket.spentMicroRub,
      bucket.reservedMicroRub,
    );
    if (available <= 0n) {
      continue;
    }

    const take = available < remaining ? available : remaining;
    allocations.push({ bucketId: bucket.id, reservedMicroRub: take });
    remaining -= take;
  }

  if (remaining > 0n) {
    return null;
  }

  return allocations;
}

function bucketTypeRank(type: UsageBucketType): number {
  return type === "MONTHLY" ? 0 : 1;
}
