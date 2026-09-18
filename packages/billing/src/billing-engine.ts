import { randomInt, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@vimla/database";
import { availableMicroRub, microRubToJson, topupProviderBudgetMicroRub, usedPercentFloor, type MicroRub } from "./money.js";
import { BillingError } from "./errors.js";
import { planReservationAllocations } from "./allocation.js";
import { assertPolicy, validateTopupAmount } from "./policy.js";
import { parseCheckoutSnapshot, toCheckoutSnapshotJson } from "./billing-subject.js";
import { classifyTBankStatus, isPaidDomainStatus, nextDomainStatus, type ProviderMoneyEvent } from "./payment-states.js";
import { FREE_PLAN_CODE, EffectivePlanResolver } from "./effective-plan.js";
import {
  addChargebackToEconomics,
  addRefundToEconomics,
  ensurePaymentEconomics,
} from "./payment-economics.js";
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
          const paymentId = await this.lockPaymentId(tx, event);
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
                providerStatus: event.providerStatus,
                sanitizedPayload: sanitizedEventPayload(event),
              },
            });
          } catch (error: unknown) {
            if (isUniqueConstraintError(error)) {
              return {
                duplicate: true,
                paymentId: payment.id,
                status: payment.status as PaymentStatus,
                bucketId: payment.grantedBucketId,
                subscriptionId: payment.grantedSubscriptionId,
              };
            }

            throw error;
          }

          if (
            event.providerPaymentId &&
            payment.providerPaymentId &&
            event.providerPaymentId !== payment.providerPaymentId
          ) {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "RECONCILIATION_REQUIRED",
                providerStatus: event.providerStatus,
              },
            });
            this.logger.error(
              {
                operation: "processPaymentEvent",
                userId: payment.userId,
                paymentId: payment.id,
                result: "payment_id_mismatch",
              },
              "Verified notification PaymentId does not match the stored provider payment",
            );
            return {
              duplicate: false,
              paymentId: payment.id,
              status: "RECONCILIATION_REQUIRED",
              bucketId: null,
              subscriptionId: null,
            };
          }

          if (
            event.amountMicroRub !== undefined &&
            event.amountMicroRub !== payment.amountMicroRub
          ) {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "RECONCILIATION_REQUIRED",
                providerStatus: event.providerStatus,
              },
            });
            this.logger.error(
              {
                operation: "processPaymentEvent",
                userId: payment.userId,
                paymentId: payment.id,
                amountMicroRub: microRubToJson(event.amountMicroRub),
                result: "amount_mismatch",
              },
              "Verified payment amount does not match checkout snapshot",
            );
            return {
              duplicate: false,
              paymentId: payment.id,
              status: "RECONCILIATION_REQUIRED",
              bucketId: null,
              subscriptionId: null,
            };
          }

          const moneyEvent = moneyEventFromInput(event);
          if (moneyEvent === "confirmed") {
            if (payment.status === "SUCCEEDED") {
              return {
                duplicate: false,
                paymentId: payment.id,
                status: "SUCCEEDED",
                bucketId: payment.grantedBucketId,
                subscriptionId: payment.grantedSubscriptionId,
              };
            }
            if (payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
              return {
                duplicate: false,
                paymentId: payment.id,
                status: payment.status as PaymentStatus,
                bucketId: payment.grantedBucketId,
                subscriptionId: payment.grantedSubscriptionId,
              };
            }
            if (payment.status !== "PENDING" && payment.status !== "CREATED") {
              throw new BillingError(
                "FINANCIAL_OPERATION_FAILED",
                "Payment is not grantable from its current status",
              );
            }

            const grant = await this.grantFromSucceededPayment(tx, payment, correlationId);
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "SUCCEEDED",
                providerStatus: event.providerStatus ?? "CONFIRMED",
                providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
                grantedBucketId: grant.bucketId,
                grantedSubscriptionId: grant.subscriptionId,
                fulfilledAt: new Date(),
                paymentMethod: payment.paymentMethod ?? event.paymentMethod,
                rawProviderPaymentMethod:
                  payment.rawProviderPaymentMethod ?? event.rawProviderPaymentMethod,
              },
            });
            await this.attachEconomicsSafely(tx, {
              ...payment,
              paymentMethod: payment.paymentMethod ?? event.paymentMethod ?? null,
              rawProviderPaymentMethod:
                payment.rawProviderPaymentMethod ?? event.rawProviderPaymentMethod ?? null,
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
          }

          if (moneyEvent === "refunded" || moneyEvent === "partially_refunded") {
            const refunded = await this.applyRefundAccounting(tx, payment, event, correlationId);
            return {
              duplicate: false,
              paymentId: payment.id,
              status: refunded,
              bucketId: payment.grantedBucketId,
              subscriptionId: payment.grantedSubscriptionId,
            };
          }

          if (moneyEvent === "failed" || moneyEvent === "canceled" || moneyEvent === "pending") {
            const currentStatus = payment.status as PaymentStatus;
            const next = nextDomainStatus(currentStatus, moneyEvent);
            if (next && next !== currentStatus) {
              await tx.payment.update({
                where: { id: payment.id },
                data: { status: next, providerStatus: event.providerStatus },
              });
            } else if (
              event.providerStatus &&
              !isPaidDomainStatus(currentStatus) &&
              currentStatus !== "REFUNDED" &&
              currentStatus !== "PARTIALLY_REFUNDED" &&
              currentStatus !== "RECONCILIATION_REQUIRED"
            ) {
              await tx.payment.update({
                where: { id: payment.id },
                data: { providerStatus: event.providerStatus },
              });
            }
            return {
              duplicate: false,
              paymentId: payment.id,
              status: (next ?? payment.status) as PaymentStatus,
              bucketId: null,
              subscriptionId: null,
            };
          }

          if (event.eventType === "payment.chargeback") {
            await this.appendLedger(tx, {
              userId: payment.userId,
              paymentId: payment.id,
              bucketId: payment.grantedBucketId ?? undefined,
              type: "ADJUSTMENT",
              amountMicroRub: 0n,
              metadata: {
                correlationId: correlationId ?? null,
                reason: "chargeback",
                providerStatus: event.providerStatus ?? null,
              },
            });
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "RECONCILIATION_REQUIRED",
                providerStatus: event.providerStatus ?? "CHARGEBACK",
              },
            });
            await addChargebackToEconomics(tx, payment.id, payment.amountMicroRub);
            return {
              duplicate: false,
              paymentId: payment.id,
              status: "RECONCILIATION_REQUIRED",
              bucketId: payment.grantedBucketId,
              subscriptionId: payment.grantedSubscriptionId,
            };
          }

          return {
            duplicate: false,
            paymentId: payment.id,
            status: payment.status as PaymentStatus,
            bucketId: payment.grantedBucketId,
            subscriptionId: payment.grantedSubscriptionId,
          };
        },
        transactionOptions(),
      ),
    );
  }

  async createPendingPayment(input: {
    userId: string;
    provider: string;
    providerPaymentId?: string | null;
    providerOrderId?: string;
    idempotencyKey?: string;
    kind: PaymentKind;
    amountMicroRub: MicroRub;
    planVersionId?: string;
    planCode?: PlanCode;
    status?: "CREATED" | "PENDING";
    paymentUrl?: string;
    providerStatus?: string;
  }): Promise<{ paymentId: string; providerOrderId: string }> {
    const snapshot = await this.buildCheckoutSnapshot(input);

    if (input.idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: {
          userId_kind_idempotencyKey: {
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { paymentId: existing.id, providerOrderId: existing.providerOrderId };
      }
    }

    try {
      const payment = await this.prisma.payment.create({
        data: {
          userId: input.userId,
          billingSubjectType: "USER",
          provider: input.provider,
          providerPaymentId: input.providerPaymentId ?? null,
          providerOrderId: input.providerOrderId ?? randomUUID(),
          providerStatus: input.providerStatus,
          paymentUrl: input.paymentUrl,
          kind: input.kind,
          amountMicroRub: snapshot.customerPaymentAmountMicroRub,
          currency: "RUB",
          status: input.status ?? "PENDING",
          planVersionId: snapshot.planVersionId,
          topupPolicyVersionId: snapshot.topupPolicyVersionId,
          idempotencyKey: input.idempotencyKey ?? randomUUID(),
          checkoutSnapshot: toCheckoutSnapshotJson(snapshot),
        },
      });
      return { paymentId: payment.id, providerOrderId: payment.providerOrderId };
    } catch (error: unknown) {
      if (input.idempotencyKey && isUniqueConstraintError(error)) {
        const existing = await this.prisma.payment.findUnique({
          where: {
            userId_kind_idempotencyKey: {
              userId: input.userId,
              kind: input.kind,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { paymentId: existing.id, providerOrderId: existing.providerOrderId };
        }
      }
      throw error;
    }
  }

  async attachProviderCheckout(input: {
    paymentId: string;
    userId: string;
    providerPaymentId: string;
    paymentUrl: string;
    providerStatus?: string;
  }): Promise<void> {
    const updated = await this.prisma.payment.updateMany({
      where: { id: input.paymentId, userId: input.userId },
      data: {
        providerPaymentId: input.providerPaymentId,
        paymentUrl: input.paymentUrl,
        providerStatus: input.providerStatus,
        status: "PENDING",
      },
    });
    if (updated.count !== 1) {
      throw new BillingError("PAYMENT_NOT_FOUND", "Payment was not found");
    }
  }

  async getPaymentForUser(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
    });
    if (!payment) {
      throw new BillingError("PAYMENT_NOT_FOUND", "Payment was not found");
    }
    return payment;
  }

  async listPaymentsForUser(userId: string, limit = 50) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });
  }

  async listPendingPayments(olderThan: Date, limit = 50) {
    return this.prisma.payment.findMany({
      where: {
        status: { in: ["CREATED", "PENDING"] },
        updatedAt: { lte: olderThan },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
  }

  async findOpenSubscriptionCheckout(userId: string, idempotencyKey: string) {
    return this.prisma.payment.findFirst({
      where: {
        userId,
        kind: "SUBSCRIPTION",
        status: { in: ["CREATED", "PENDING"] },
        NOT: { idempotencyKey },
      },
    });
  }

  async initializeHostedCheckout(
    paymentId: string,
    initialize: (payment: {
      id: string;
      userId: string;
      providerOrderId: string;
      amountMicroRub: bigint;
      paymentUrl: string | null;
      providerPaymentId: string | null;
    }) => Promise<{ providerPaymentId: string; paymentUrl: string; providerStatus?: string }>,
  ): Promise<{ paymentId: string; paymentUrl: string; initialized: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
        const payment = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!payment) {
          throw new BillingError("PAYMENT_NOT_FOUND", "Payment was not found");
        }
        if (payment.paymentUrl) {
          return { paymentId: payment.id, paymentUrl: payment.paymentUrl, initialized: false };
        }

        const checkout = await initialize(payment);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: checkout.providerPaymentId,
            paymentUrl: checkout.paymentUrl,
            providerStatus: checkout.providerStatus,
            status: "PENDING",
          },
        });
        return { paymentId: payment.id, paymentUrl: checkout.paymentUrl, initialized: true };
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000, maxWait: TRANSACTION_MAX_WAIT_MS },
    );
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

  async getSpendableUsageState(userId: string): Promise<{
    availableMicroRub: MicroRub;
    activeReservedMicroRub: MicroRub;
  }> {
    const now = new Date();
    const buckets = await this.prisma.usageBucket.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        totalMicroRub: true,
        spentMicroRub: true,
        reservedMicroRub: true,
      },
    });

    return {
      availableMicroRub: buckets.reduce(
        (sum, bucket) =>
          sum +
          availableMicroRub(
            bucket.totalMicroRub,
            bucket.spentMicroRub,
            bucket.reservedMicroRub,
          ),
        0n,
      ),
      activeReservedMicroRub: buckets.reduce(
        (sum, bucket) => sum + bucket.reservedMicroRub,
        0n,
      ),
    };
  }

  async getSpendableUsageMicroRub(userId: string): Promise<MicroRub> {
    return (await this.getSpendableUsageState(userId)).availableMicroRub;
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
      if (plan.code === FREE_PLAN_CODE) {
        return [];
      }
      const current = plansCurrentVersion(plan.versions, now);
      if (!current || current.priceMicroRub <= 0n) {
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
    if (!plan || !plan.active || plan.code === FREE_PLAN_CODE) {
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
      checkoutSnapshot: Prisma.JsonValue;
    },
    correlationId?: string,
  ): Promise<{ bucketId: string; subscriptionId: string | null }> {
    const snapshot = parseCheckoutSnapshot(payment.checkoutSnapshot);
    if (snapshot.customerPaymentAmountMicroRub !== payment.amountMicroRub) {
      throw new BillingError(
        "PAYMENT_RECONCILIATION_REQUIRED",
        "Checkout snapshot amount does not match the payment",
      );
    }

    if (payment.kind === "SUBSCRIPTION") {
      const planVersionId = snapshot.planVersionId ?? payment.planVersionId;
      if (!planVersionId) {
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

      const periodDays = snapshot.subscriptionPeriodDays ?? this.policy.subscriptionPeriodDays;
      const periodStart = new Date();
      const periodEnd = new Date(periodStart.getTime() + periodDays * 24 * 60 * 60 * 1000);

      let subscription;
      try {
        subscription = await tx.subscription.create({
          data: {
            userId: payment.userId,
            planVersionId,
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
          totalMicroRub: snapshot.providerBudgetGrantMicroRub,
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
        amountMicroRub: snapshot.providerBudgetGrantMicroRub,
        metadata: {
          correlationId: correlationId ?? null,
          subscriptionId: subscription.id,
          planVersionId,
        },
      });

      return { bucketId: bucket.id, subscriptionId: subscription.id };
    }

    const bucket = await tx.usageBucket.create({
      data: {
        userId: payment.userId,
        type: "TOPUP",
        totalMicroRub: snapshot.providerBudgetGrantMicroRub,
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
      amountMicroRub: snapshot.providerBudgetGrantMicroRub,
      metadata: {
        correlationId: correlationId ?? null,
        paidMicroRub: microRubToJson(snapshot.customerPaymentAmountMicroRub),
        ratioBps: (snapshot.topupRatioBps ?? this.policy.topupProviderCostRatioBps).toString(10),
      },
    });

    return { bucketId: bucket.id, subscriptionId: null };
  }

  private async applyRefundAccounting(
    tx: BillingTx,
    payment: {
      id: string;
      userId: string;
      kind: string;
      status: string;
      amountMicroRub: bigint;
      grantedBucketId: string | null;
      grantedSubscriptionId: string | null;
      checkoutSnapshot: Prisma.JsonValue;
    },
    event: PaymentEventInput,
    correlationId?: string,
  ): Promise<PaymentStatus> {
    const snapshot = parseCheckoutSnapshot(payment.checkoutSnapshot);
    const fullRefund = event.eventType !== "payment.partially_refunded";
    if (!fullRefund && payment.kind === "SUBSCRIPTION") {
      await this.appendLedger(tx, {
        userId: payment.userId,
        paymentId: payment.id,
        bucketId: payment.grantedBucketId ?? undefined,
        type: "ADJUSTMENT",
        amountMicroRub: 0n,
        metadata: {
          correlationId: correlationId ?? null,
          reason: "unsupported_partial_subscription_refund",
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "RECONCILIATION_REQUIRED",
          providerStatus: event.providerStatus,
        },
      });
      return "RECONCILIATION_REQUIRED";
    }

    let revokeGrant = snapshot.providerBudgetGrantMicroRub;
    if (!fullRefund && event.refundAmountMicroRub !== undefined && snapshot.topupRatioBps) {
      revokeGrant = topupProviderBudgetMicroRub(event.refundAmountMicroRub, snapshot.topupRatioBps);
    }

    if (payment.grantedBucketId) {
      const bucketRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM usage_bucket WHERE id = ${payment.grantedBucketId} FOR UPDATE
      `;
      if (bucketRows[0]) {
        const bucket = await tx.usageBucket.findUniqueOrThrow({
          where: { id: payment.grantedBucketId },
        });
        const unused = bucket.totalMicroRub - bucket.spentMicroRub - bucket.reservedMicroRub;
        const revoke = unused < revokeGrant ? unused : revokeGrant;
        if (revoke > 0n) {
          await tx.usageBucket.update({
            where: { id: bucket.id },
            data: { totalMicroRub: bucket.totalMicroRub - revoke },
          });
          await this.appendLedger(tx, {
            userId: payment.userId,
            bucketId: bucket.id,
            paymentId: payment.id,
            type: "BUCKET_REVOKED",
            amountMicroRub: -revoke,
            metadata: {
              correlationId: correlationId ?? null,
              reason: "refund",
            },
          });
        }
        if (revoke < revokeGrant) {
          await this.appendLedger(tx, {
            userId: payment.userId,
            bucketId: bucket.id,
            paymentId: payment.id,
            type: "ADJUSTMENT",
            amountMicroRub: 0n,
            metadata: {
              correlationId: correlationId ?? null,
              reason: "refund_shortfall",
              requestedMicroRub: revokeGrant.toString(10),
              revokedMicroRub: revoke.toString(10),
            },
          });
        }
      }
    }

    if (fullRefund && payment.grantedSubscriptionId) {
      await tx.subscription.updateMany({
        where: { id: payment.grantedSubscriptionId, userId: payment.userId, status: "ACTIVE" },
        data: { status: "CANCELED" },
      });
    }

    const nextStatus: PaymentStatus = fullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        providerStatus: event.providerStatus,
      },
    });
    const refundedAmount = fullRefund
      ? payment.amountMicroRub
      : (event.refundAmountMicroRub ?? 0n);
    await addRefundToEconomics(tx, payment.id, refundedAmount);
    return nextStatus;
  }

  private async lockPaymentId(tx: BillingTx, event: PaymentEventInput): Promise<string | null> {
    if (event.providerPaymentId) {
      const byProvider = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM payment
        WHERE provider = ${event.provider}
          AND "providerPaymentId" = ${event.providerPaymentId}
        FOR UPDATE
      `;
      if (byProvider[0]?.id) {
        return byProvider[0].id;
      }
    }
    if (event.orderId) {
      const byOrder = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM payment
        WHERE "providerOrderId" = ${event.orderId}
        FOR UPDATE
      `;
      return byOrder[0]?.id ?? null;
    }
    return null;
  }

  private async buildCheckoutSnapshot(input: {
    kind: PaymentKind;
    amountMicroRub: MicroRub;
    planVersionId?: string;
    planCode?: PlanCode;
  }) {
    if (input.kind === "TOPUP") {
      const topupPolicy = await this.getPublishedTopupPolicy();
      const ratioBps = topupPolicy
        ? BigInt(topupPolicy.usageGrantRatioBps)
        : this.policy.topupProviderCostRatioBps;
      const bounds = {
        minTopupMicroRub: topupPolicy?.minPurchaseMicroRub ?? this.policy.minTopupMicroRub,
        maxTopupMicroRub: topupPolicy?.maxPurchaseMicroRub ?? this.policy.maxTopupMicroRub,
        topupProviderCostRatioBps: ratioBps,
        subscriptionPeriodDays: this.policy.subscriptionPeriodDays,
      };
      validateTopupAmount(input.amountMicroRub, bounds);
      return {
        billingSubjectType: "USER" as const,
        kind: "TOPUP" as const,
        customerPaymentAmountMicroRub: input.amountMicroRub,
        providerBudgetGrantMicroRub: topupProviderBudgetMicroRub(input.amountMicroRub, ratioBps),
        topupRatioBps: ratioBps,
        topupPolicyVersionId: topupPolicy?.id,
      };
    }

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
    return {
      billingSubjectType: "USER" as const,
      kind: "SUBSCRIPTION" as const,
      customerPaymentAmountMicroRub: input.amountMicroRub,
      providerBudgetGrantMicroRub: planVersion.providerBudgetMicroRub,
      planVersionId: planVersion.id,
      planCode: input.planCode,
      subscriptionPeriodDays: planVersion.subscriptionPeriodDays,
    };
  }

  async assertTopupPurchasable(userId: string): Promise<void> {
    const effective = await new EffectivePlanResolver(this.prisma).resolve(userId);
    if (!effective.topupAllowed) {
      throw new BillingError("INVALID_TOPUP_AMOUNT", "Top-up is not allowed on the current plan");
    }
  }

  async getPublishedTopupPolicy(now = new Date()) {
    return this.prisma.topupPolicyVersion.findFirst({
      where: {
        status: "PUBLISHED",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  private async attachEconomicsSafely(
    tx: BillingTx,
    payment: {
      id: string;
      amountMicroRub: bigint;
      provider: string;
      createdAt: Date;
      paymentMethod: string | null;
      rawProviderPaymentMethod: string | null;
    },
  ): Promise<void> {
    await ensurePaymentEconomics(tx, {
      paymentId: payment.id,
      grossAmountMicroRub: payment.amountMicroRub,
      provider: payment.provider,
      occurredAt: payment.createdAt,
      paymentMethod: asPaymentMethod(payment.paymentMethod),
      rawProviderPaymentMethod: payment.rawProviderPaymentMethod,
    }).then((result) => {
      if (result.status === "RECONCILIATION_REQUIRED") {
        this.logger.warn(
          {
            operation: "paymentEconomics",
            paymentId: payment.id,
            result: "finance_policy_missing",
          },
          "Payment economics requires fee policy reconciliation",
        );
      }
      if (payment.paymentMethod === "UNKNOWN") {
        this.logger.warn(
          {
            operation: "paymentEconomics",
            paymentId: payment.id,
            result: "unknown_payment_method",
          },
          "Payment method could not be normalized",
        );
      }
    });
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
      type: "BUCKET_GRANTED" | "TOPUP_GRANTED" | "BUCKET_REVOKED" | "RESERVATION_CREATED" | "USAGE_SETTLED" | "RESERVATION_RELEASED" | "ADJUSTMENT";
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

  return {
    totalMicroRub: total,
    spentMicroRub: spent,
    reservedMicroRub: reserved,
    remainingMicroRub: remaining,
    usedPercent: usedPercentFloor(spent, total),
  };
}

function plansCurrentVersion<
  T extends {
    validFrom: Date;
    validTo: Date | null;
    priceMicroRub: bigint;
    id: string;
    status?: string;
  },
>(versions: T[], now: Date): T | undefined {
  return versions.find(
    (version) =>
      (version.status ?? "PUBLISHED") === "PUBLISHED" &&
      version.validFrom <= now &&
      (version.validTo === null || version.validTo > now),
  );
}

function asPaymentMethod(value: string | null): "CARD" | "SBP" | "T_PAY" | "OTHER" | "UNKNOWN" | null {
  if (value === "CARD" || value === "SBP" || value === "T_PAY" || value === "OTHER" || value === "UNKNOWN") {
    return value;
  }
  return null;
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

function moneyEventFromInput(
  event: PaymentEventInput,
): ProviderMoneyEvent {
  if (event.providerStatus) {
    const classified = classifyTBankStatus(event.providerStatus);
    if (classified !== "ignore") {
      return classified;
    }
  }
  switch (event.eventType) {
    case "payment.succeeded":
      return "confirmed";
    case "payment.failed":
      return "failed";
    case "payment.canceled":
      return "canceled";
    case "payment.refunded":
      return "refunded";
    case "payment.partially_refunded":
      return "partially_refunded";
    default:
      return "ignore";
  }
}

function sanitizedEventPayload(event: PaymentEventInput): Prisma.InputJsonValue {
  return {
    eventType: event.eventType,
    providerStatus: event.providerStatus ?? null,
    orderId: event.orderId ?? null,
    amountMicroRub: event.amountMicroRub?.toString(10) ?? null,
  };
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
