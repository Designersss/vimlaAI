import type { PrismaClient } from "@vimla/database";
import type { BillingEngine, BillingLogger } from "@vimla/billing";

const RECOVERABLE_STATUSES = [
  "CREATED",
  "RESERVED",
  "PROVIDER_STARTED",
  "STREAMING",
  "RECONCILIATION_REQUIRED",
] as const;

export interface AiReconciliationCounters {
  scanned: number;
  released: number;
  settled: number;
  held: number;
  failedBeforeReservation: number;
  errors: number;
}

/** Reconciles only stale durable state; it never calls an AI provider. */
export class AiRequestReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly billing: BillingEngine,
    private readonly logger: BillingLogger,
  ) {}

  async reconcile(olderThan: Date, batchSize: number): Promise<AiReconciliationCounters> {
    const requests = await this.prisma.aiRequest.findMany({
      where: { status: { in: [...RECOVERABLE_STATUSES] }, createdAt: { lt: olderThan } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.min(batchSize, 500)),
    });
    const counters: AiReconciliationCounters = {
      scanned: requests.length,
      released: 0,
      settled: 0,
      held: 0,
      failedBeforeReservation: 0,
      errors: 0,
    };

    for (const request of requests) {
      try {
        const reservation = request.reservationId
          ? await this.prisma.usageReservation.findUnique({ where: { id: request.reservationId } })
          : await this.prisma.usageReservation.findUnique({
              where: { userId_requestId: { userId: request.userId, requestId: request.id } },
            });

        if (request.providerActualCostMicroRub !== null && reservation) {
          const settled = await this.billing.settleUsage({
            userId: request.userId,
            reservationId: reservation.id,
            actualMicroRub: request.providerActualCostMicroRub,
            correlationId: `ai-reconcile:${request.id}`,
          });
          await this.prisma.aiRequest.updateMany({
            where: { id: request.id, status: { in: [...RECOVERABLE_STATUSES] } },
            data: {
              reservationId: reservation.id,
              // Financial recovery cannot reconstruct a response that was only in
              // process memory when the process crashed.
              status: request.outputText === null ? "FAILED" : "SUCCEEDED",
              financialStatus: settled.status === "ANOMALY" ? "ANOMALY" : "SETTLED",
              userSettledUsageMicroRub: settled.settledMicroRub,
              finishedAt: request.finishedAt ?? new Date(),
            },
          });
          counters.settled += 1;
          continue;
        }

        const providerWasNotStarted = request.status === "CREATED" || request.status === "RESERVED";
        if (providerWasNotStarted) {
          if (reservation) {
            await this.billing.releaseUsage({
              userId: request.userId,
              reservationId: reservation.id,
              correlationId: `ai-reconcile:${request.id}`,
            });
            counters.released += 1;
          } else {
            counters.failedBeforeReservation += 1;
          }
          await this.prisma.aiRequest.updateMany({
            where: { id: request.id, status: { in: ["CREATED", "RESERVED"] } },
            data: {
              reservationId: reservation?.id,
              status: "FAILED",
              financialStatus: reservation ? "RELEASED" : "NONE",
              finishedAt: new Date(),
            },
          });
          continue;
        }

        await this.prisma.aiRequest.updateMany({
          where: { id: request.id, status: { in: ["PROVIDER_STARTED", "STREAMING", "RECONCILIATION_REQUIRED"] } },
          data: {
            reservationId: reservation?.id,
            status: "RECONCILIATION_REQUIRED",
            financialStatus: "RECONCILIATION_HOLD",
            finishedAt: request.finishedAt ?? new Date(),
          },
        });
        counters.held += 1;
        this.logger.error(
          { operation: "ai_reconcile", aiRequestId: request.id, result: "ambiguous_provider_outcome" },
          "AI request remains on reconciliation hold",
        );
      } catch (error: unknown) {
        counters.errors += 1;
        this.logger.error(
          {
            operation: "ai_reconcile",
            aiRequestId: request.id,
            result: "retry_required",
            error: error instanceof Error ? error.message : "unknown",
          },
          "AI request reconciliation failed",
        );
      }
    }
    return counters;
  }
}
