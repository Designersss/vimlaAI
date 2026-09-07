import type { BillingEngine } from "./billing-engine.js";
import type { MicroRub } from "./money.js";
import type { ReservationView } from "./types.js";

export async function simulateProviderUsage(
  engine: BillingEngine,
  input: {
    userId: string;
    requestId: string;
    estimatedMicroRub: MicroRub;
    outcome: "success" | "failure";
    actualMicroRub?: MicroRub;
    correlationId?: string;
  },
): Promise<ReservationView> {
  const reserved = await engine.reserveUsage({
    userId: input.userId,
    requestId: input.requestId,
    estimatedProviderCostMicroRub: input.estimatedMicroRub,
    correlationId: input.correlationId,
  });

  if (input.outcome === "failure") {
    return engine.releaseUsage({
      userId: input.userId,
      reservationId: reserved.id,
      correlationId: input.correlationId,
    });
  }

  return engine.settleUsage({
    userId: input.userId,
    reservationId: reserved.id,
    actualMicroRub: input.actualMicroRub ?? input.estimatedMicroRub,
    correlationId: input.correlationId,
  });
}
