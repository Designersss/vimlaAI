import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@vimla/database";
import { availableMicroRub, microRubToJson, topupProviderBudgetMicroRub, usedPercentFloor, type MicroRub } from "./money.js";
import { BillingError } from "./errors.js";
import { planReservationAllocations } from "./allocation.js";
import { assertPolicy, validateTopupAmount } from "./policy.js";
import type {
  ActiveSubscriptionView,
  BillingLogger,
  BillingPolicy,
  LockedBucket,
  PaymentEventInput,
  PaymentKind,
  PaymentStatus,
  PlanCode,
  ProcessPaymentResult,
  ReservationStatus,
  ReservationView,
  RetailPlan,
  UsageBucketType,
  UsageSnapshot,
} from "./types.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const TRANSACTION_TIMEOUT_MS = 8_000;
const TRANSACTION_MAX_WAIT_MS = 3_000;

type BillingTx = Prisma.TransactionClient;

export class BillingEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly policy: BillingPolicy,
    private readonly logger: BillingLogger = silentLogger,
  ) {
    assertPolicy(policy);
  }

  async reserveUsage(input: {
    userId: string;
    requestId: string;
    estimatedProviderCostMicroRub: MicroRub;
    correlationId?: string;
  }): Promise<ReservationView> {
    this.assertPositiveAmount(input.estimatedProviderCostMicroRub);

    return this.withRetry("reserveUsage", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.usageReservation.findUnique({
            where: {
              userId_requestId: {
                userId: input.userId,
                requestId: input.requestId,
              },
            },
            include: { allocations: true },
          });

          if (existing) {
            if (
              existing.status === "ACTIVE" &&
              existing.estimatedMicroRub === input.estimatedProviderCostMicroRub
            ) {
              return toReservationView(existing);
            }

            throw new BillingError(
              "RESERVATION_CONFLICT",
              "Reservation requestId already exists with a different state",
            );
          }

          const buckets = await this.lockUserBuckets(tx, input.userId);
          const allocations = planReservationAllocations(
            buckets,
            input.estimatedProviderCostMicroRub,
          );
          if (!allocations) {
            throw new BillingError("INSUFFICIENT_USAGE", "Not enough usage remaining");
          }

          const reservation = await tx.usageReservation.create({
            data: {
              userId: input.userId,
              requestId: input.requestId,
              estimatedMicroRub: input.estimatedProviderCostMicroRub,
              settledMicroRub: 0n,
              status: "ACTIVE",
            },
          });

          for (const allocation of allocations) {
            const bucket = buckets.find((item) => item.id === allocation.bucketId);
            if (!bucket) {
              throw new BillingError("FINANCIAL_OPERATION_FAILED", "Allocation bucket missing");
            }

            await tx.usageReservationAllocation.create({
              data: {
                reservationId: reservation.id,
                bucketId: allocation.bucketId,
                reservedMicroRub: allocation.reservedMicroRub,
                settledMicroRub: 0n,
              },
            });

            await tx.usageBucket.update({
              where: { id: bucket.id },
              data: {
                reservedMicroRub: bucket.reservedMicroRub + allocation.reservedMicroRub,
              },
            });
            bucket.reservedMicroRub += allocation.reservedMicroRub;

            await this.appendLedger(tx, {
              userId: input.userId,
              bucketId: bucket.id,
              reservationId: reservation.id,
              type: "RESERVATION_CREATED",
              amountMicroRub: 0n,
              metadata: {
                correlationId: input.correlationId ?? null,
                reservedMicroRub: microRubToJson(allocation.reservedMicroRub),
                requestId: input.requestId,
              },
            });
          }

          this.logger.info(
            {
              operation: "reserveUsage",
              userId: input.userId,
              reservationId: reservation.id,
              requestId: input.requestId,
              amountMicroRub: microRubToJson(input.estimatedProviderCostMicroRub),
              result: "reserved",
            },
            "Usage reserved",
          );

          return this.getReservation(tx, reservation.id);
        },
        transactionOptions(),
      ),
    );
  }

  async settleUsage(input: {
    userId: string;
    reservationId: string;
    actualMicroRub: MicroRub;
    correlationId?: string;
  }): Promise<ReservationView> {
    this.assertNonNegativeAmount(input.actualMicroRub);

    return this.withRetry("settleUsage", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const reservation = await this.lockReservationForUser(
            tx,
            input.userId,
            input.reservationId,
          );

          if (reservation.status === "SETTLED") {
            if (reservation.settledMicroRub === input.actualMicroRub) {
              return this.getReservation(tx, reservation.id);
            }

            throw new BillingError(
              "RESERVATION_CONFLICT",
              "Reservation already settled at a different amount",
            );
          }

          if (reservation.status === "RELEASED") {
            throw new BillingError(
              "RESERVATION_ALREADY_RELEASED",
              "Released reservations cannot be settled",
            );
          }

          if (reservation.status === "ANOMALY") {
            throw new BillingError(
              "RESERVATION_CONFLICT",
              "Anomalous reservations cannot be settled again",
            );
          }

          const allocations = await tx.usageReservationAllocation.findMany({
            where: { reservationId: reservation.id },
          });
          const buckets = await this.lockUserBuckets(
            tx,
            input.userId,
            allocations.map((allocation) => allocation.bucketId),
          );
          const allocationOrder = orderAllocations(allocations, buckets);

          let actual = input.actualMicroRub;
          let anomaly = false;

          if (actual > reservation.estimatedMicroRub) {
            const extra = actual - reservation.estimatedMicroRub;
            const extraPlan = planReservationAllocations(
              spendableBuckets(buckets),
              extra,
            );

            if (extraPlan) {
              for (const extraAllocation of extraPlan) {
                const bucket = buckets.find((item) => item.id === extraAllocation.bucketId);
                if (!bucket) {
                  throw new BillingError("FINANCIAL_OPERATION_FAILED", "Extra bucket missing");
                }

                const existing = allocationOrder.find(
                  (item) => item.bucketId === extraAllocation.bucketId,
                );
                if (existing) {
                  existing.reservedMicroRub += extraAllocation.reservedMicroRub;
                  await tx.usageReservationAllocation.update({
                    where: { id: existing.id },
                    data: { reservedMicroRub: existing.reservedMicroRub },
                  });
                } else {
                  const created = await tx.usageReservationAllocation.create({
                    data: {
                      reservationId: reservation.id,
                      bucketId: extraAllocation.bucketId,
                      reservedMicroRub: extraAllocation.reservedMicroRub,
                      settledMicroRub: 0n,
                    },
                  });
                  allocationOrder.push(created);
                }

                await tx.usageBucket.update({
                  where: { id: bucket.id },
                  data: {
                    reservedMicroRub: bucket.reservedMicroRub + extraAllocation.reservedMicroRub,
                  },
                });
                bucket.reservedMicroRub += extraAllocation.reservedMicroRub;
              }

              await tx.usageReservation.update({
                where: { id: reservation.id },
                data: {
                  estimatedMicroRub: reservation.estimatedMicroRub + extra,
                },
              });
              reservation.estimatedMicroRub += extra;
            } else {
              actual = reservation.estimatedMicroRub;
              anomaly = true;
              this.logger.error(
                {
                  operation: "settleUsage",
                  userId: input.userId,
                  reservationId: reservation.id,
                  amountMicroRub: microRubToJson(input.actualMicroRub),
                  result: "anomaly_actual_exceeds_reserve",
                },
                "Actual provider cost exceeded reservation and extra usage was unavailable",
              );
            }
          }

          let remainingToSettle = actual;
          for (const allocation of allocationOrder) {
            const settleAmount =
              remainingToSettle < allocation.reservedMicroRub
                ? remainingToSettle
                : allocation.reservedMicroRub;
            const releaseAmount = allocation.reservedMicroRub - settleAmount;
            const bucket = buckets.find((item) => item.id === allocation.bucketId);
            if (!bucket) {
              throw new BillingError("FINANCIAL_OPERATION_FAILED", "Settle bucket missing");
            }

            await tx.usageReservationAllocation.update({
              where: { id: allocation.id },
              data: { settledMicroRub: settleAmount },
            });

            await tx.usageBucket.update({
              where: { id: bucket.id },
              data: {
                reservedMicroRub: bucket.reservedMicroRub - allocation.reservedMicroRub,
                spentMicroRub: bucket.spentMicroRub + settleAmount,
              },
            });
            bucket.reservedMicroRub -= allocation.reservedMicroRub;
            bucket.spentMicroRub += settleAmount;

            if (settleAmount > 0n) {
              await this.appendLedger(tx, {
                userId: input.userId,
                bucketId: bucket.id,
                reservationId: reservation.id,
                type: "USAGE_SETTLED",
                amountMicroRub: -settleAmount,
                metadata: {
                  correlationId: input.correlationId ?? null,
                  settledMicroRub: microRubToJson(settleAmount),
                },
              });
            }

            if (releaseAmount > 0n) {
              await this.appendLedger(tx, {
                userId: input.userId,
                bucketId: bucket.id,
                reservationId: reservation.id,
                type: "RESERVATION_RELEASED",
                amountMicroRub: 0n,
                metadata: {
                  correlationId: input.correlationId ?? null,
                  releasedMicroRub: microRubToJson(releaseAmount),
                },
              });
            }

            remainingToSettle -= settleAmount;
          }

          const nextStatus: ReservationStatus = anomaly ? "ANOMALY" : "SETTLED";
          await tx.usageReservation.update({
            where: { id: reservation.id },
            data: {
              settledMicroRub: actual,
              status: nextStatus,
              settledAt: new Date(),
            },
          });

          this.logger.info(
            {
              operation: "settleUsage",
              userId: input.userId,
              reservationId: reservation.id,
              amountMicroRub: microRubToJson(actual),
              result: nextStatus.toLowerCase(),
            },
            "Usage settled",
          );

          return this.getReservation(tx, reservation.id);
        },
        transactionOptions(),
      ),
    );
  }

  async releaseUsage(input: {
    userId: string;
    reservationId: string;
    correlationId?: string;
  }): Promise<ReservationView> {
    return this.withRetry("releaseUsage", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const reservation = await this.lockReservationForUser(
            tx,
            input.userId,
            input.reservationId,
          );

          if (reservation.status === "RELEASED") {
            return this.getReservation(tx, reservation.id);
          }

          if (reservation.status === "SETTLED" || reservation.status === "ANOMALY") {
            throw new BillingError(
              "RESERVATION_ALREADY_SETTLED",
              "Settled reservations cannot be released",
            );
          }

          const allocations = await tx.usageReservationAllocation.findMany({
            where: { reservationId: reservation.id },
          });
          const buckets = await this.lockUserBuckets(
            tx,
            input.userId,
            allocations.map((allocation) => allocation.bucketId),
          );

          for (const allocation of allocations) {
            const bucket = buckets.find((item) => item.id === allocation.bucketId);
            if (!bucket) {
              throw new BillingError("FINANCIAL_OPERATION_FAILED", "Release bucket missing");
            }

            await tx.usageBucket.update({
              where: { id: bucket.id },
              data: {
                reservedMicroRub: bucket.reservedMicroRub - allocation.reservedMicroRub,
              },
            });
            bucket.reservedMicroRub -= allocation.reservedMicroRub;

            await tx.usageReservationAllocation.update({
              where: { id: allocation.id },
              data: { settledMicroRub: 0n },
            });

            await this.appendLedger(tx, {
              userId: input.userId,
              bucketId: bucket.id,
              reservationId: reservation.id,
              type: "RESERVATION_RELEASED",
              amountMicroRub: 0n,
              metadata: {
                correlationId: input.correlationId ?? null,
                releasedMicroRub: microRubToJson(allocation.reservedMicroRub),
              },
            });
          }

          await tx.usageReservation.update({
            where: { id: reservation.id },
            data: {
              status: "RELEASED",
              settledMicroRub: 0n,
              settledAt: new Date(),
            },
          });

          this.logger.info(
            {
              operation: "releaseUsage",
              userId: input.userId,
              reservationId: reservation.id,
              amountMicroRub: microRubToJson(reservation.estimatedMicroRub),
              result: "released",
            },
            "Usage reservation released",
          );

          return this.getReservation(tx, reservation.id);
        },
        transactionOptions(),
      ),
    );
  }

  async processPaymentEvent(
    event: PaymentEventInput,
    correlationId?: string,
  ): Promise<ProcessPaymentResult> {
    return this.withRetry("processPaymentEvent", async () =>
      this.prisma.$transaction(
        async (tx) => {
          const paymentRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM payment
            WHERE provider = ${event.provider}
              AND "providerPaymentId" = ${event.providerPaymentId}
            FOR UPDATE
          `;
          const paymentId = paymentRows[0]?.id;
          if (!paymentId) {
            throw new BillingError("PAYMENT_NOT_FOUND", "Payment was not found");
          }

          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: paymentId },
          });

          try {
            await tx.paymentEvent.create({
              data: {
                provider: event.provider,
                providerEventId: event.providerEventId,
                paymentId: payment.id,
                eventType: event.eventType,
              },
            });
          } catch (error: unknown) {
            if (isUniqueConstraintError(error)) {
              return {
                duplicate: true,
                paymentId: payment.id,
                status: payment.status as PaymentStatus,
                bucketId: null,
                subscriptionId: null,
              };
            }

            throw error;
          }

          if (event.eventType === "payment.failed") {
            if (payment.status === "PENDING") {
              await tx.payment.update({
                where: { id: payment.id },
                data: { status: "FAILED" },
              });
            }

            return {
              duplicate: false,
              paymentId: payment.id,
              status: "FAILED",
              bucketId: null,
              subscriptionId: null,
            };
          }

          if (event.eventType === "payment.refunded") {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            });
            return {
              duplicate: false,
              paymentId: payment.id,
              status: "REFUNDED",
              bucketId: null,
              subscriptionId: null,
            };
          }

          if (payment.status === "SUCCEEDED") {
            return {
              duplicate: false,
              paymentId: payment.id,
              status: "SUCCEEDED",
              bucketId: null,
              subscriptionId: null,
            };
          }

          if (payment.status !== "PENDING") {
            throw new BillingError(
              "FINANCIAL_OPERATION_FAILED",
              "Payment is not grantable from its current status",
            );
          }

          const grant = await this.grantFromSucceededPayment(tx, payment, correlationId);
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: "SUCCEEDED" },
          });

          this.logger.info(
            {
              operation: "processPaymentEvent",
              userId: payment.userId,
              paymentId: payment.id,
              amountMicroRub: microRubToJson(payment.amountMicroRub),
              result: "granted",
            },
            "Payment event granted usage",
          );

          return {
            duplicate: false,
            paymentId: payment.id,
            status: "SUCCEEDED",
            bucketId: grant.bucketId,
            subscriptionId: grant.subscriptionId,
          };
        },
        transactionOptions(),
      ),
    );
  }

  async createPendingPayment(input: {
    userId: string;
    provider: string;
    providerPaymentId: string;
    kind: PaymentKind;
    amountMicroRub: MicroRub;
    planVersionId?: string;
  }): Promise<{ paymentId: string }> {
    if (input.kind === "TOPUP") {
      validateTopupAmount(input.amountMicroRub, this.policy);
    } else {
      if (!input.planVersionId) {
        throw new BillingError("PLAN_NOT_FOUND", "Subscription payment requires a plan version");
      }

      const planVersion = await this.prisma.planVersion.findUnique({
        where: { id: input.planVersionId },
      });
      if (!planVersion) {
        throw new BillingError("PLAN_NOT_FOUND", "Plan version was not found");
      }

      if (planVersion.priceMicroRub !== input.amountMicroRub) {
        throw new BillingError(
          "FINANCIAL_OPERATION_FAILED",
          "Payment amount must match the current plan price",
        );
      }
    }

    if (input.amountMicroRub <= 0n) {
      throw new BillingError("INVALID_TOPUP_AMOUNT", "Payment amount must be greater than zero");
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
        kind: input.kind,
        amountMicroRub: input.amountMicroRub,
        currency: "RUB",
        status: "PENDING",
        planVersionId: input.planVersionId,
      },
    });

    return { paymentId: payment.id };
  }

  async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
    const now = new Date();
    const buckets = await this.prisma.usageBucket.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
          { reservedMicroRub: { gt: 0 } },
        ],
      },
    });

    return {
      monthly: summarizeBuckets(buckets.filter((bucket) => bucket.type === "MONTHLY")),
      topup: summarizeBuckets(buckets.filter((bucket) => bucket.type === "TOPUP")),
    };
  }

  async getActiveSubscription(userId: string): Promise<ActiveSubscriptionView | null> {
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { planVersion: { include: { plan: true } } },
    });

    if (!subscription || subscription.periodEnd <= now) {
      return null;
    }

    return {
      id: subscription.id,
      status: "ACTIVE",
      planCode: subscription.planVersion.plan.code as PlanCode,
      planName: subscription.planVersion.plan.name,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
    };
  }

  async listRetailPlans(): Promise<RetailPlan[]> {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      include: { versions: { orderBy: { validFrom: "desc" } } },
      orderBy: { code: "asc" },
    });
    const now = new Date();

    return plans.flatMap((plan) => {
      const current = plansCurrentVersion(plan.versions, now);
      if (!current) {
        return [];
      }

      return [
        {
          code: plan.code as PlanCode,
          name: plan.name,
          priceMicroRub: current.priceMicroRub,
        },
      ];
    });
  }

  async findCurrentPlanVersionByCode(code: string): Promise<{
    planId: string;
    planVersionId: string;
    priceMicroRub: MicroRub;
  }> {
    const plan = await this.prisma.plan.findUnique({
      where: { code },
      include: { versions: { orderBy: { validFrom: "desc" } } },
    });
    if (!plan || !plan.active) {
      throw new BillingError("PLAN_NOT_FOUND", "Plan was not found");
    }

    const current = plansCurrentVersion(plan.versions, new Date());
    if (!current) {
      throw new BillingError("PLAN_NOT_FOUND", "Plan has no current version");
    }

    return {
      planId: plan.id,
      planVersionId: current.id,
      priceMicroRub: current.priceMicroRub,
    };
  }

  private async grantFromSucceededPayment(
    tx: BillingTx,
    payment: {
      id: string;
      userId: string;
      kind: string;
      amountMicroRub: bigint;
      planVersionId: string | null;
    },
    correlationId?: string,
  ): Promise<{ bucketId: string; subscriptionId: string | null }> {
    if (payment.kind === "SUBSCRIPTION") {
      if (!payment.planVersionId) {
        throw new BillingError("PLAN_NOT_FOUND", "Subscription payment is missing a plan version");
      }

      const active = await tx.subscription.findFirst({
        where: { userId: payment.userId, status: "ACTIVE" },
      });
      if (active) {
        throw new BillingError(
          "SUBSCRIPTION_ALREADY_ACTIVE",
          "User already has an active subscription",
        );
      }

      const planVersion = await tx.planVersion.findUnique({
        where: { id: payment.planVersionId },
      });
      if (!planVersion) {
        throw new BillingError("PLAN_NOT_FOUND", "Plan version was not found");
      }

      const periodStart = new Date();
      const periodEnd = new Date(
        periodStart.getTime() + this.policy.subscriptionPeriodDays * 24 * 60 * 60 * 1000,
      );

      let subscription;
      try {
        subscription = await tx.subscription.create({
          data: {
            userId: payment.userId,
            planVersionId: planVersion.id,
            status: "ACTIVE",
            periodStart,
            periodEnd,
          },
        });
      } catch (error: unknown) {
        if (isUniqueConstraintError(error)) {
          throw new BillingError(
            "SUBSCRIPTION_ALREADY_ACTIVE",
            "User already has an active subscription",
          );
        }
        throw error;
      }

      const bucket = await tx.usageBucket.create({
        data: {
          userId: payment.userId,
          type: "MONTHLY",
          totalMicroRub: planVersion.providerBudgetMicroRub,
          spentMicroRub: 0n,
          reservedMicroRub: 0n,
          expiresAt: periodEnd,
          sourceType: "SUBSCRIPTION",
          sourceId: subscription.id,
        },
      });

      await this.appendLedger(tx, {
        userId: payment.userId,
        bucketId: bucket.id,
        paymentId: payment.id,
        type: "BUCKET_GRANTED",
        amountMicroRub: planVersion.providerBudgetMicroRub,
        metadata: {
          correlationId: correlationId ?? null,
          subscriptionId: subscription.id,
          planVersionId: planVersion.id,
        },
      });

      return { bucketId: bucket.id, subscriptionId: subscription.id };
    }

    validateTopupAmount(payment.amountMicroRub, this.policy);
    const budget = topupProviderBudgetMicroRub(
      payment.amountMicroRub,
      this.policy.topupProviderCostRatioBps,
    );

    const bucket = await tx.usageBucket.create({
      data: {
        userId: payment.userId,
        type: "TOPUP",
        totalMicroRub: budget,
        spentMicroRub: 0n,
        reservedMicroRub: 0n,
        expiresAt: null,
        sourceType: "PAYMENT",
        sourceId: payment.id,
      },
    });

    await this.appendLedger(tx, {
      userId: payment.userId,
      bucketId: bucket.id,
      paymentId: payment.id,
      type: "TOPUP_GRANTED",
      amountMicroRub: budget,
      metadata: {
        correlationId: correlationId ?? null,
        paidMicroRub: microRubToJson(payment.amountMicroRub),
        ratioBps: this.policy.topupProviderCostRatioBps.toString(10),
      },
    });

    return { bucketId: bucket.id, subscriptionId: null };
  }

  private async lockUserBuckets(
    tx: BillingTx,
    userId: string,
    includeIds: readonly string[] = [],
  ): Promise<LockedBucket[]> {
    const now = new Date();
    const includeClause =
      includeIds.length > 0
        ? Prisma.sql`id IN (${Prisma.join(includeIds)}) OR`
        : Prisma.empty;
    const rows = await tx.$queryRaw<RawBucketRow[]>`
      SELECT
        id,
        type,
        "totalMicroRub",
        "spentMicroRub",
        "reservedMicroRub",
        "expiresAt",
        "createdAt"
      FROM usage_bucket
      WHERE "userId" = ${userId}
        AND (
          ${includeClause}
          "expiresAt" IS NULL
          OR "expiresAt" > ${now}
        )
      ORDER BY
        CASE WHEN type = 'MONTHLY' THEN 0 ELSE 1 END,
        "expiresAt" ASC NULLS LAST,
        "createdAt" ASC
      FOR UPDATE
    `;

    return rows.map((row) => ({
      id: row.id,
      type: asBucketType(row.type),
      totalMicroRub: toMicroRub(row.totalMicroRub),
      spentMicroRub: toMicroRub(row.spentMicroRub),
      reservedMicroRub: toMicroRub(row.reservedMicroRub),
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  }

  private async lockReservationForUser(
    tx: BillingTx,
    userId: string,
    reservationId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM usage_reservation
      WHERE id = ${reservationId}
        AND "userId" = ${userId}
      FOR UPDATE
    `;
    if (!rows[0]) {
      throw new BillingError("RESERVATION_NOT_FOUND", "Reservation was not found");
    }

    return tx.usageReservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
  }

  private async getReservation(tx: BillingTx, reservationId: string): Promise<ReservationView> {
    const reservation = await tx.usageReservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: { allocations: true },
    });
    return toReservationView(reservation);
  }

  private async appendLedger(
    tx: BillingTx,
    entry: {
      userId: string;
      bucketId?: string;
      reservationId?: string;
      paymentId?: string;
      type: "BUCKET_GRANTED" | "TOPUP_GRANTED" | "RESERVATION_CREATED" | "USAGE_SETTLED" | "RESERVATION_RELEASED" | "ADJUSTMENT";
      amountMicroRub: MicroRub;
      metadata: Record<string, string | null>;
    },
  ): Promise<void> {
    await tx.usageLedgerEntry.create({
      data: {
        userId: entry.userId,
        bucketId: entry.bucketId,
        reservationId: entry.reservationId,
        paymentId: entry.paymentId,
        type: entry.type,
        amountMicroRub: entry.amountMicroRub,
        metadata: entry.metadata,
      },
    });
  }

  private async withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
        if (error instanceof BillingError || !isRetryableTransactionError(error)) {
          throw error;
        }

        if (attempt === MAX_TRANSACTION_ATTEMPTS) {
          break;
        }

        const delayMs = 25 * 2 ** (attempt - 1) + randomInt(0, 25);
        await sleep(delayMs);
      }
    }

    this.logger.error(
      {
        operation,
        result: "transaction_retry_exhausted",
        errorName: lastError instanceof Error ? lastError.name : "unknown",
      },
      "Billing transaction failed closed after bounded retries",
    );
    throw new BillingError(
      "FINANCIAL_OPERATION_FAILED",
      "The financial operation could not be completed safely",
    );
  }

  private assertPositiveAmount(amount: MicroRub): void {
    if (amount <= 0n) {
      throw new BillingError("INSUFFICIENT_USAGE", "Estimated usage must be greater than zero");
    }
  }

  private assertNonNegativeAmount(amount: MicroRub): void {
    if (amount < 0n) {
      throw new BillingError("FINANCIAL_OPERATION_FAILED", "Actual usage cannot be negative");
    }
  }
}

interface RawBucketRow {
  id: string;
  type: string;
  totalMicroRub: bigint | string;
  spentMicroRub: bigint | string;
  reservedMicroRub: bigint | string;
  expiresAt: Date | null;
  createdAt: Date;
}

function transactionOptions(): {
  isolationLevel: Prisma.TransactionIsolationLevel;
  timeout: number;
  maxWait: number;
} {
  return {
    isolationLevel: "ReadCommitted",
    timeout: TRANSACTION_TIMEOUT_MS,
    maxWait: TRANSACTION_MAX_WAIT_MS,
  };
}

function toReservationView(reservation: {
  id: string;
  userId: string;
  requestId: string;
  estimatedMicroRub: bigint;
  settledMicroRub: bigint;
  status: string;
  allocations: Array<{
    bucketId: string;
    reservedMicroRub: bigint;
    settledMicroRub: bigint;
  }>;
}): ReservationView {
  return {
    id: reservation.id,
    userId: reservation.userId,
    requestId: reservation.requestId,
    estimatedMicroRub: reservation.estimatedMicroRub,
    settledMicroRub: reservation.settledMicroRub,
    status: reservation.status as ReservationStatus,
    allocations: reservation.allocations.map((allocation) => ({
      bucketId: allocation.bucketId,
      reservedMicroRub: allocation.reservedMicroRub,
      settledMicroRub: allocation.settledMicroRub,
    })),
  };
}

function orderAllocations<
  T extends { id: string; bucketId: string; reservedMicroRub: bigint; settledMicroRub: bigint },
>(allocations: T[], buckets: LockedBucket[]): T[] {
  const rank = new Map(buckets.map((bucket, index) => [bucket.id, index]));
  return [...allocations].sort(
    (left, right) => (rank.get(left.bucketId) ?? 0) - (rank.get(right.bucketId) ?? 0),
  );
}

function spendableBuckets(buckets: LockedBucket[]): LockedBucket[] {
  const now = Date.now();
  return buckets.filter(
    (bucket) => bucket.expiresAt === null || bucket.expiresAt.getTime() > now,
  );
}

function summarizeBuckets(
  buckets: Array<{
    totalMicroRub: bigint;
    spentMicroRub: bigint;
    reservedMicroRub: bigint;
  }>,
): UsageSnapshot["monthly"] {
  const total = buckets.reduce((sum, bucket) => sum + bucket.totalMicroRub, 0n);
  const spent = buckets.reduce((sum, bucket) => sum + bucket.spentMicroRub, 0n);
  const reserved = buckets.reduce((sum, bucket) => sum + bucket.reservedMicroRub, 0n);
  const remaining = availableMicroRub(total, spent, reserved);
  const committed = spent + reserved;

  return {
    totalMicroRub: total,
    spentMicroRub: spent,
    reservedMicroRub: reserved,
    remainingMicroRub: remaining,
    usedPercent: usedPercentFloor(committed, total),
  };
}

function plansCurrentVersion<
  T extends { validFrom: Date; validTo: Date | null; priceMicroRub: bigint; id: string },
>(versions: T[], now: Date): T | undefined {
  return versions.find(
    (version) => version.validFrom <= now && (version.validTo === null || version.validTo > now),
  );
}

function asBucketType(type: string): UsageBucketType {
  if (type === "MONTHLY" || type === "TOPUP") {
    return type;
  }

  throw new BillingError("FINANCIAL_OPERATION_FAILED", "Unknown usage bucket type");
}

function toMicroRub(value: bigint | string): MicroRub {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new BillingError("FINANCIAL_OPERATION_FAILED", "Database returned a non-integer money value");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "P2034" || code === "P2028") {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return message.includes("40001") || message.includes("40P01") || /deadlock/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const silentLogger: BillingLogger = {
  info() {},
  warn() {},
  error() {},
};
