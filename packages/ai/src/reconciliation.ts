import type { BillingEngine, BillingLogger } from "@vimla/billing";
import type { PrismaClient } from "@vimla/database";

const PRE_PROVIDER_TURN_STATUSES = ["CREATED", "RESERVED"] as const;
const POST_PROVIDER_TURN_STATUSES = [
  "PROVIDER_STARTING",
  "PROVIDER_IN_FLIGHT",
  "USAGE_DURABLE",
  "SETTLING",
  "RECONCILIATION_REQUIRED",
] as const;
const LEGACY_PRE_PROVIDER_STATUSES = ["CREATED", "RESERVED"] as const;
const LEGACY_POST_PROVIDER_STATUSES = [
  "PROVIDER_STARTED",
  "STREAMING",
  "RECONCILIATION_REQUIRED",
] as const;

export interface AiReconciliationCounters {
  scannedTurns: number;
  scannedLegacyRequests: number;
  released: number;
  settled: number;
  held: number;
  failedBeforeProvider: number;
  finalized: number;
  errors: number;
}

export interface AiReconciliationCutoffs {
  preProvider: Date;
  provider: Date;
}

/**
 * Reconciles durable AI financial state only. It never calls an AI provider.
 * Provider-start ambiguity is intentionally conservative: unknown provider work
 * remains held until exact usage can be proven.
 */
export class AiRequestReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly billing: BillingEngine,
    private readonly logger: BillingLogger,
  ) {}

  async reconcile(
    cutoffs: AiReconciliationCutoffs,
    batchSize: number,
  ): Promise<AiReconciliationCounters> {
    const take = Math.max(1, Math.min(batchSize, 500));
    const counters: AiReconciliationCounters = {
      scannedTurns: 0,
      scannedLegacyRequests: 0,
      released: 0,
      settled: 0,
      held: 0,
      failedBeforeProvider: 0,
      finalized: 0,
      errors: 0,
    };

    const turns = await this.prisma.aIProviderTurn.findMany({
      where: {
        OR: [
          {
            status: { in: [...PRE_PROVIDER_TURN_STATUSES] },
            updatedAt: { lt: cutoffs.preProvider },
          },
          {
            status: { in: [...POST_PROVIDER_TURN_STATUSES] },
            updatedAt: { lt: cutoffs.provider },
          },
        ],
      },
      include: { aiRequest: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take,
    });
    counters.scannedTurns = turns.length;

    for (const turn of turns) {
      try {
        await this.reconcileProviderTurn(turn, counters);
      } catch (error: unknown) {
        counters.errors += 1;
        this.logger.error(
          {
            event: "ai_reconciliation_error",
            operation: "ai_reconcile_turn",
            aiRequestId: turn.aiRequestId,
            providerTurnId: turn.id,
            result: "retry_required",
            error: error instanceof Error ? error.message : "unknown",
          },
          "AI provider turn reconciliation failed",
        );
      }
    }

    const remaining = Math.max(0, take - turns.length);
    if (remaining === 0) {
      await this.logScanMetrics(counters);
      return counters;
    }

    const legacyRequests = await this.prisma.aiRequest.findMany({
      where: {
        providerTurn: { is: null },
        OR: [
          {
            status: { in: [...LEGACY_PRE_PROVIDER_STATUSES] },
            createdAt: { lt: cutoffs.preProvider },
          },
          {
            status: { in: [...LEGACY_POST_PROVIDER_STATUSES] },
            OR: [
              { startedAt: { lt: cutoffs.provider } },
              { startedAt: null, createdAt: { lt: cutoffs.provider } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: remaining,
    });
    counters.scannedLegacyRequests = legacyRequests.length;

    for (const request of legacyRequests) {
      try {
        await this.reconcileLegacyRequest(request, counters);
      } catch (error: unknown) {
        counters.errors += 1;
        this.logger.error(
          {
            event: "ai_reconciliation_error",
            operation: "ai_reconcile_legacy",
            aiRequestId: request.id,
            result: "retry_required",
            error: error instanceof Error ? error.message : "unknown",
          },
          "Legacy AI request reconciliation failed",
        );
      }
    }

    await this.logScanMetrics(counters);
    return counters;
  }

  private async logScanMetrics(
    counters: AiReconciliationCounters,
  ): Promise<void> {
    const now = Date.now();
    const [
      activeReservationCount,
      oldestActiveReservation,
      reconciliationHoldCount,
      oldestReconciliationHold,
    ] = await Promise.all([
      this.prisma.usageReservation.count({ where: { status: "ACTIVE" } }),
      this.prisma.usageReservation.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.prisma.aiRequest.count({
        where: { financialStatus: "RECONCILIATION_HOLD" },
      }),
      this.prisma.aiRequest.findFirst({
        where: {
          financialStatus: "RECONCILIATION_HOLD",
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: "asc" },
        select: { finishedAt: true },
      }),
    ]);

    this.logger.info(
      {
        event: "ai_reconciliation_scanned",
        scannedTurns: counters.scannedTurns,
        scannedLegacyRequests: counters.scannedLegacyRequests,
        activeReservationCount,
        oldestActiveReservationAgeMs: oldestActiveReservation
          ? Math.max(0, now - oldestActiveReservation.createdAt.getTime())
          : 0,
        reconciliationHoldCount,
        oldestReconciliationHoldAgeMs: oldestReconciliationHold?.finishedAt
          ? Math.max(0, now - oldestReconciliationHold.finishedAt.getTime())
          : 0,
        settledCount: counters.settled,
        releasedCount: counters.released,
        heldCount: counters.held,
        errorCount: counters.errors,
      },
      "AI reconciliation scan completed",
    );
  }

  private async reconcileProviderTurn(
    turn: {
      id: string;
      status: string;
      aiRequestId: string;
      toolCallError: boolean;
      providerInterrupted: boolean;
      aiRequest: {
        id: string;
        userId: string;
        reservationId: string | null;
        status: string;
        financialStatus: string;
        estimatedCostMicroRub: bigint;
        providerActualCostMicroRub: bigint | null;
        userSettledUsageMicroRub: bigint | null;
        outputText: string | null;
        finishedAt: Date | null;
      };
    },
    counters: AiReconciliationCounters,
  ): Promise<void> {
    const request = turn.aiRequest;
    const reservation = await this.findReservation(request);

    if (request.providerActualCostMicroRub !== null) {
      await this.reconcileDurableUsage(
        request,
        turn.id,
        turn.toolCallError,
        turn.providerInterrupted,
        reservation,
        counters,
      );
      return;
    }

    if (PRE_PROVIDER_TURN_STATUSES.includes(turn.status as (typeof PRE_PROVIDER_TURN_STATUSES)[number])) {
      await this.failBeforeProvider(request, turn.id, reservation, counters);
      return;
    }

    await this.holdAmbiguous(request, turn.id, reservation?.id ?? null, counters);
  }

  private async reconcileLegacyRequest(
    request: {
      id: string;
      userId: string;
      reservationId: string | null;
      status: string;
      financialStatus: string;
      estimatedCostMicroRub: bigint;
      providerActualCostMicroRub: bigint | null;
      userSettledUsageMicroRub: bigint | null;
      outputText: string | null;
      finishedAt: Date | null;
    },
    counters: AiReconciliationCounters,
  ): Promise<void> {
    const reservation = await this.findReservation(request);

    if (request.providerActualCostMicroRub !== null) {
      await this.reconcileDurableUsage(
        request,
        null,
        false,
        false,
        reservation,
        counters,
      );
      return;
    }

    if (
      LEGACY_PRE_PROVIDER_STATUSES.includes(
        request.status as (typeof LEGACY_PRE_PROVIDER_STATUSES)[number],
      )
    ) {
      await this.failBeforeProvider(request, null, reservation, counters);
      return;
    }

    await this.holdAmbiguous(request, null, reservation?.id ?? null, counters);
  }

  private async reconcileDurableUsage(
    request: {
      id: string;
      userId: string;
      estimatedCostMicroRub: bigint;
      providerActualCostMicroRub: bigint | null;
      outputText: string | null;
      finishedAt: Date | null;
    },
    providerTurnId: string | null,
    toolCallError: boolean,
    providerInterrupted: boolean,
    reservation: {
      id: string;
      estimatedMicroRub: bigint;
      settledMicroRub: bigint;
      status: string;
    } | null,
    counters: AiReconciliationCounters,
  ): Promise<void> {
    const actual = request.providerActualCostMicroRub;
    if (actual === null || !reservation) {
      await this.holdAmbiguous(request, providerTurnId, reservation?.id ?? null, counters);
      return;
    }

    if (actual > reservation.estimatedMicroRub) {
      await this.holdAmbiguous(request, providerTurnId, reservation.id, counters);
      this.logger.error(
        {
          event: "ai_cost_anomaly",
          operation: "ai_reconcile",
          aiRequestId: request.id,
          providerTurnId,
          result: "boundedness_violation",
        },
        "Provider actual cost exceeded the funded reservation",
      );
      return;
    }

    if (reservation.status === "RELEASED") {
      await this.holdAmbiguous(request, providerTurnId, reservation.id, counters);
      this.logger.error(
        {
          operation: "ai_reconcile",
          aiRequestId: request.id,
          providerTurnId,
          result: "usage_after_release",
        },
        "Provider usage exists after its reservation was released",
      );
      return;
    }

    let settledMicroRub = reservation.settledMicroRub;
    let settledStatus = reservation.status;
    if (reservation.status === "ACTIVE") {
      const settled = await this.billing.settleUsage({
        userId: request.userId,
        reservationId: reservation.id,
        actualMicroRub: actual,
        correlationId: `ai-reconcile:${request.id}`,
      });
      settledMicroRub = settled.settledMicroRub;
      settledStatus = settled.status;
      counters.settled += 1;
      this.logger.info(
        {
          event: "ai_reconciliation_settled",
          aiRequestId: request.id,
          providerTurnId,
          reservationId: reservation.id,
        },
        "AI reconciliation settled durable usage",
      );
    } else if (
      reservation.status !== "SETTLED" &&
      reservation.status !== "ANOMALY"
    ) {
      await this.holdAmbiguous(request, providerTurnId, reservation.id, counters);
      return;
    }

    const finalRequestStatus =
      request.outputText === null || toolCallError || providerInterrupted
        ? "FAILED"
        : "SUCCEEDED";
    await this.prisma.$transaction(async (tx) => {
      await tx.aiRequest.update({
        where: { id: request.id },
        data: {
          reservationId: reservation.id,
          status: finalRequestStatus,
          financialStatus: settledStatus === "ANOMALY" ? "ANOMALY" : "SETTLED",
          userSettledUsageMicroRub: settledMicroRub,
          finishedAt: request.finishedAt ?? new Date(),
        },
      });
      if (providerTurnId) {
        await tx.aIProviderTurn.update({
          where: { id: providerTurnId },
          data: { status: "SUCCEEDED" },
        });
      }
    });
    counters.finalized += 1;
  }

  private async failBeforeProvider(
    request: {
      id: string;
      userId: string;
      finishedAt: Date | null;
    },
    providerTurnId: string | null,
    reservation: {
      id: string;
      status: string;
    } | null,
    counters: AiReconciliationCounters,
  ): Promise<void> {
    let financialStatus = "NONE";

    if (reservation?.status === "ACTIVE") {
      await this.billing.releaseUsage({
        userId: request.userId,
        reservationId: reservation.id,
        correlationId: `ai-reconcile:${request.id}`,
      });
      counters.released += 1;
      this.logger.info(
        {
          event: "ai_reconciliation_released",
          aiRequestId: request.id,
          providerTurnId,
          reservationId: reservation.id,
        },
        "AI reconciliation released pre-provider reservation",
      );
      financialStatus = "RELEASED";
    } else if (reservation?.status === "RELEASED") {
      financialStatus = "RELEASED";
    } else if (reservation) {
      await this.holdAmbiguous(request, providerTurnId, reservation.id, counters);
      return;
    } else {
      counters.failedBeforeProvider += 1;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiRequest.update({
        where: { id: request.id },
        data: {
          reservationId: reservation?.id ?? null,
          status: "FAILED",
          financialStatus,
          finishedAt: request.finishedAt ?? new Date(),
        },
      });
      if (providerTurnId) {
        await tx.aIProviderTurn.update({
          where: { id: providerTurnId },
          data: { status: "FAILED_PRE_PROVIDER" },
        });
      }
    });
  }

  private async holdAmbiguous(
    request: {
      id: string;
      finishedAt: Date | null;
    },
    providerTurnId: string | null,
    reservationId: string | null,
    counters: AiReconciliationCounters,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.aiRequest.update({
        where: { id: request.id },
        data: {
          reservationId,
          status: "RECONCILIATION_REQUIRED",
          financialStatus: "RECONCILIATION_HOLD",
          finishedAt: request.finishedAt ?? new Date(),
        },
      });
      if (providerTurnId) {
        await tx.aIProviderTurn.update({
          where: { id: providerTurnId },
          data: { status: "RECONCILIATION_REQUIRED" },
        });
      }
    });
    counters.held += 1;
    this.logger.warn(
      {
        event: "ai_reconciliation_held",
        aiRequestId: request.id,
        providerTurnId,
        reservationId,
      },
      "AI reconciliation retained ambiguous work on hold",
    );
  }

  private async findReservation(request: {
    id: string;
    userId: string;
    reservationId: string | null;
  }) {
    if (request.reservationId) {
      const byId = await this.prisma.usageReservation.findUnique({
        where: { id: request.reservationId },
      });
      if (byId) {
        return byId;
      }
    }

    return this.prisma.usageReservation.findUnique({
      where: {
        userId_requestId: {
          userId: request.userId,
          requestId: request.id,
        },
      },
    });
  }
}
