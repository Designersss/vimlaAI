import type { BillingEngine } from "./billing-engine.js";
import { billingSubjectForActor } from "./billing-subject.js";
import { BillingError } from "./errors.js";
import { microRubToKopecks, type MicroRub } from "./money.js";
import { paymentEventFromNotification } from "./payment-events.js";
import { PaymentMetrics } from "./payment-metrics.js";
import type { PaymentProvider } from "./payment-provider.js";
import { classifyTBankStatus } from "./payment-states.js";
import { verifyTBankNotification, type VerifiedTBankNotification } from "./tbank-provider.js";
import type { BillingLogger, PaymentKind, PlanCode, ProcessPaymentResult } from "./types.js";

export interface PaymentCheckoutUrls {
  notificationUrl: string;
  successUrl: string;
  failUrl: string;
}

export interface PaymentVerifierConfig {
  terminalKey: string;
  password: string;
}

export interface PublicPaymentView {
  paymentId: string;
  kind: PaymentKind;
  status: string;
  amountMicroRub: string;
  currency: string;
  createdAt: string;
  paymentUrl: string | null;
  providerStatus: string | null;
  orderId: string;
  providerPaymentId: string | null;
}

export class PaymentService {
  constructor(
    private readonly engine: BillingEngine,
    private readonly provider: PaymentProvider,
    private readonly urls: PaymentCheckoutUrls,
    private readonly verifier: PaymentVerifierConfig,
    private readonly logger: BillingLogger,
    private readonly metrics: PaymentMetrics = new PaymentMetrics(),
  ) {}

  async checkoutSubscription(input: {
    userId: string;
    planCode: PlanCode;
    idempotencyKey: string;
    locale: "ru" | "en";
  }): Promise<{ paymentId: string; paymentUrl: string }> {
    const subject = billingSubjectForActor(input.userId);
    const active = await this.engine.getActiveSubscription(subject.userId);
    if (active) {
      throw new BillingError("SUBSCRIPTION_ALREADY_ACTIVE", "An active subscription already exists");
    }
    const open = await this.engine.findOpenSubscriptionCheckout(subject.userId, input.idempotencyKey);
    if (open) {
      throw new BillingError(
        "PAYMENT_ALREADY_PROCESSED",
        "A subscription checkout is already in progress",
      );
    }

    const plan = await this.engine.findCurrentPlanVersionByCode(input.planCode);
    this.assertWholeKopecks(plan.priceMicroRub);
    const pending = await this.engine.createPendingPayment({
      userId: subject.userId,
      provider: this.provider.id,
      kind: "SUBSCRIPTION",
      amountMicroRub: plan.priceMicroRub,
      planVersionId: plan.planVersionId,
      planCode: input.planCode,
      idempotencyKey: input.idempotencyKey,
      status: "CREATED",
    });

    return this.ensureHostedCheckout(
      pending.paymentId,
      subject.userId,
      input.locale,
      "SUBSCRIPTION",
      input.planCode,
    );
  }

  async checkoutTopup(input: {
    userId: string;
    amountMicroRub: MicroRub;
    idempotencyKey: string;
    locale: "ru" | "en";
  }): Promise<{ paymentId: string; paymentUrl: string }> {
    const subject = billingSubjectForActor(input.userId);
    await this.engine.assertTopupPurchasable(subject.userId);
    this.assertWholeKopecks(input.amountMicroRub);
    const pending = await this.engine.createPendingPayment({
      userId: subject.userId,
      provider: this.provider.id,
      kind: "TOPUP",
      amountMicroRub: input.amountMicroRub,
      idempotencyKey: input.idempotencyKey,
      status: "CREATED",
    });
    return this.ensureHostedCheckout(pending.paymentId, subject.userId, input.locale, "TOPUP");
  }

  async getPayment(userId: string, paymentId: string): Promise<PublicPaymentView> {
    return toPublicPayment(await this.engine.getPaymentForUser(userId, paymentId));
  }

  async listPayments(userId: string): Promise<PublicPaymentView[]> {
    return (await this.engine.listPaymentsForUser(userId)).map(toPublicPayment);
  }

  async handleProviderNotification(payload: unknown): Promise<{ ok: true; duplicate: boolean }> {
    const notification = verifyTBankNotification(
      payload,
      this.verifier.terminalKey,
      this.verifier.password,
    );
    return this.fulfillVerifiedNotification(notification);
  }

  async fulfillVerifiedNotification(
    notification: VerifiedTBankNotification,
  ): Promise<{ ok: true; duplicate: boolean }> {
    const event = paymentEventFromNotification(this.provider.id, notification);
    const result = await this.engine.processPaymentEvent(event);
    this.recordFulfillment(result);
    return { ok: true, duplicate: result.duplicate };
  }

  async reconcilePending(olderThan: Date, limit = 25): Promise<number> {
    const payments = await this.engine.listPendingPayments(olderThan, limit);
    let fulfilled = 0;
    for (const payment of payments) {
      try {
        const result = await this.reconcileRecord(payment);
        if (result?.status === "SUCCEEDED") {
          fulfilled += 1;
        }
        this.metrics.recordReconciliation(true);
      } catch {
        this.metrics.recordReconciliation(false);
        this.logger.error(
          {
            operation: "reconcilePending",
            paymentId: payment.id,
            userId: payment.userId,
            result: "reconciliation_failed",
          },
          "Payment reconciliation failed closed",
        );
      }
    }
    return fulfilled;
  }

  async refundOwnedPayment(input: {
    userId: string;
    paymentId: string;
    amountMicroRub?: MicroRub;
  }): Promise<ProcessPaymentResult> {
    const payment = await this.engine.getPaymentForUser(input.userId, input.paymentId);
    if (!payment.providerPaymentId) {
      throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Payment has no provider identity");
    }
    const started = Date.now();
    let state;
    try {
      state = await this.provider.cancel({
        providerPaymentId: payment.providerPaymentId,
        amountMicroRub: input.amountMicroRub,
      });
      this.metrics.recordProviderCall(Date.now() - started, false);
    } catch (error: unknown) {
      this.metrics.recordProviderCall(Date.now() - started, true);
      throw error;
    }

    const moneyEvent = classifyTBankStatus(state.providerStatus);
    const result = await this.engine.processPaymentEvent({
      provider: this.provider.id,
      providerEventId: `refund:${payment.id}:${state.providerStatus}:${state.amountMicroRub.toString(10)}`,
      providerPaymentId: state.providerPaymentId,
      orderId: state.orderId,
      eventType:
        moneyEvent === "partially_refunded" ? "payment.partially_refunded" : "payment.refunded",
      providerStatus: state.providerStatus,
      amountMicroRub: payment.amountMicroRub,
      refundAmountMicroRub: input.amountMicroRub,
    });
    this.metrics.recordRefund(result.status === "RECONCILIATION_REQUIRED");
    return result;
  }

  private async ensureHostedCheckout(
    paymentId: string,
    userId: string,
    locale: "ru" | "en",
    kind: PaymentKind,
    planCode?: PlanCode,
  ): Promise<{ paymentId: string; paymentUrl: string }> {
    const description =
      kind === "SUBSCRIPTION" ? `Vimla ${planCode ?? "plan"}` : "Vimla usage top-up";
    const successUrl = withPaymentId(this.urls.successUrl, paymentId);
    const failUrl = withPaymentId(this.urls.failUrl, paymentId);

    const result = await this.engine.initializeHostedCheckout(paymentId, async (payment) => {
      const started = Date.now();
      try {
        const checkout = await this.provider.createHostedCheckout({
          orderId: payment.providerOrderId,
          amountMicroRub: payment.amountMicroRub,
          description,
          language: locale,
          notificationUrl: this.urls.notificationUrl,
          successUrl,
          failUrl,
        });
        this.metrics.recordProviderCall(Date.now() - started, false);
        return checkout;
      } catch (error: unknown) {
        this.metrics.recordProviderCall(Date.now() - started, true);
        throw error;
      }
    });

    if (result.initialized) {
      this.metrics.recordCheckoutCreated();
      this.logger.info(
        {
          operation: "checkout",
          userId,
          paymentId: result.paymentId,
          result: "checkout_created",
        },
        "Hosted checkout created",
      );
    }

    return { paymentId: result.paymentId, paymentUrl: result.paymentUrl };
  }

  private async reconcileRecord(payment: {
    id: string;
    userId: string;
    providerPaymentId: string | null;
    providerOrderId: string;
    amountMicroRub: bigint;
    status: string;
  }): Promise<ProcessPaymentResult | null> {
    if (payment.status !== "CREATED" && payment.status !== "PENDING") {
      return null;
    }

    const started = Date.now();
    let providerStatus: string;
    let providerPaymentId = payment.providerPaymentId;
    let amountMicroRub = payment.amountMicroRub;
    let paymentMethod: string | undefined;
    let rawProviderPaymentMethod: string | undefined;
    try {
      if (payment.providerPaymentId) {
        const state = await this.provider.getState(payment.providerPaymentId);
        providerStatus = state.providerStatus;
        providerPaymentId = state.providerPaymentId;
        amountMicroRub = state.amountMicroRub;
        paymentMethod = state.paymentMethod;
        rawProviderPaymentMethod = state.rawProviderSource;
      } else {
        const checked = await this.provider.checkOrder(payment.providerOrderId);
        if (!checked) {
          this.metrics.recordProviderCall(Date.now() - started, false);
          return null;
        }
        providerStatus = checked.providerStatus;
        providerPaymentId = checked.providerPaymentId;
      }
      this.metrics.recordProviderCall(Date.now() - started, false);
    } catch (error: unknown) {
      this.metrics.recordProviderCall(Date.now() - started, true);
      throw error;
    }

    const moneyEvent = classifyTBankStatus(providerStatus);
    if (moneyEvent === "ignore" || moneyEvent === "pending") {
      return {
        duplicate: false,
        paymentId: payment.id,
        status: payment.status as ProcessPaymentResult["status"],
        bucketId: null,
        subscriptionId: null,
      };
    }

    const eventType =
      moneyEvent === "confirmed"
        ? "payment.succeeded"
        : moneyEvent === "failed"
          ? "payment.failed"
          : moneyEvent === "canceled"
            ? "payment.canceled"
            : moneyEvent === "refunded"
              ? "payment.refunded"
              : moneyEvent === "partially_refunded"
                ? "payment.partially_refunded"
                : "payment.status";

    return this.engine.processPaymentEvent({
      provider: this.provider.id,
      providerEventId: `reconcile:${payment.id}:${providerStatus}`,
      providerPaymentId: providerPaymentId ?? undefined,
      orderId: payment.providerOrderId,
      eventType,
      providerStatus,
      amountMicroRub,
      paymentMethod,
      rawProviderPaymentMethod,
    });
  }

  private recordFulfillment(result: ProcessPaymentResult): void {
    if (result.duplicate) {
      this.metrics.recordDuplicateWebhook();
      return;
    }
    if (result.status === "SUCCEEDED") {
      this.metrics.recordConfirmed();
    }
    if (result.status === "FAILED" || result.status === "CANCELED") {
      this.metrics.recordFailed();
    }
  }

  private assertWholeKopecks(amount: MicroRub): void {
    try {
      microRubToKopecks(amount);
    } catch {
      throw new BillingError("PAYMENT_AMOUNT_INVALID", "Amount is not representable as whole kopecks");
    }
  }
}

function withPaymentId(baseUrl: string, paymentId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("paymentId", paymentId);
  return url.toString();
}

function toPublicPayment(payment: {
  id: string;
  kind: string;
  status: string;
  amountMicroRub: bigint;
  currency: string;
  createdAt: Date;
  paymentUrl: string | null;
  providerStatus: string | null;
  providerOrderId: string;
  providerPaymentId: string | null;
}): PublicPaymentView {
  return {
    paymentId: payment.id,
    kind: payment.kind as PaymentKind,
    status: payment.status,
    amountMicroRub: payment.amountMicroRub.toString(10),
    currency: payment.currency,
    createdAt: payment.createdAt.toISOString(),
    paymentUrl: payment.status === "CREATED" || payment.status === "PENDING" ? payment.paymentUrl : null,
    providerStatus: payment.providerStatus,
    orderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
  };
}
