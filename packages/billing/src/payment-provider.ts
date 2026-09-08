import { randomUUID } from "node:crypto";
import type { MicroRub } from "./money.js";

export const MOCK_PAYMENT_PROVIDER_ID = "mock";

export interface HostedCheckoutInput {
  orderId: string;
  amountMicroRub: MicroRub;
  description: string;
  language: "ru" | "en";
  notificationUrl: string;
  successUrl: string;
  failUrl: string;
}

export interface HostedCheckoutResult {
  providerPaymentId: string;
  paymentUrl: string;
  providerStatus: string;
}

export interface ProviderPaymentState {
  orderId: string;
  providerPaymentId: string;
  providerStatus: string;
  amountMicroRub: MicroRub;
  success: boolean;
  paymentMethod?: string;
  rawProviderSource?: string;
}

export interface PaymentProvider {
  readonly id: string;
  createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult>;
  getState(providerPaymentId: string): Promise<ProviderPaymentState>;
  checkOrder(orderId: string): Promise<HostedCheckoutResult | null>;
  cancel(input: {
    providerPaymentId: string;
    amountMicroRub?: MicroRub;
  }): Promise<ProviderPaymentState>;
}

export interface MockPaymentEvent {
  provider: typeof MOCK_PAYMENT_PROVIDER_ID;
  providerPaymentId: string;
  providerEventId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.refunded";
}

interface MockOrder {
  orderId: string;
  providerPaymentId: string;
  status: string;
  amountMicroRub: MicroRub;
  paymentUrl: string;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = MOCK_PAYMENT_PROVIDER_ID;
  private readonly orders = new Map<string, MockOrder>();
  private readonly byProviderId = new Map<string, MockOrder>();

  constructor(private readonly enabled: boolean) {
    if (!this.enabled) {
      throw new Error("MockPaymentProvider cannot be constructed outside local/test");
    }
  }

  createPayment(kind: "SUBSCRIPTION" | "TOPUP"): { providerPaymentId: string } {
    return {
      providerPaymentId: `${MOCK_PAYMENT_PROVIDER_ID}_${kind.toLowerCase()}_${randomUUID()}`,
    };
  }

  async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult> {
    const existing = this.orders.get(input.orderId);
    if (existing) {
      return {
        providerPaymentId: existing.providerPaymentId,
        paymentUrl: existing.paymentUrl,
        providerStatus: existing.status,
      };
    }

    const providerPaymentId = `${MOCK_PAYMENT_PROVIDER_ID}_${randomUUID()}`;
    const paymentUrl = mockPaymentPageUrl(input.successUrl);
    const order: MockOrder = {
      orderId: input.orderId,
      providerPaymentId,
      status: "NEW",
      amountMicroRub: input.amountMicroRub,
      paymentUrl,
    };
    this.orders.set(input.orderId, order);
    this.byProviderId.set(providerPaymentId, order);
    return { providerPaymentId, paymentUrl, providerStatus: "NEW" };
  }

  async getState(providerPaymentId: string): Promise<ProviderPaymentState> {
    const order = this.byProviderId.get(providerPaymentId);
    if (!order) {
      return {
        orderId: "unknown",
        providerPaymentId,
        providerStatus: "NEW",
        amountMicroRub: 0n,
        success: false,
      };
    }
    return {
      orderId: order.orderId,
      providerPaymentId: order.providerPaymentId,
      providerStatus: order.status,
      amountMicroRub: order.amountMicroRub,
      success: order.status === "CONFIRMED",
    };
  }

  async checkOrder(orderId: string): Promise<HostedCheckoutResult | null> {
    const order = this.orders.get(orderId);
    if (!order) {
      return null;
    }
    return {
      providerPaymentId: order.providerPaymentId,
      paymentUrl: order.paymentUrl,
      providerStatus: order.status,
    };
  }

  async cancel(input: { providerPaymentId: string; amountMicroRub?: MicroRub }): Promise<ProviderPaymentState> {
    const order = this.byProviderId.get(input.providerPaymentId);
    if (!order) {
      throw new Error("Mock payment was not found");
    }
    order.status =
      input.amountMicroRub !== undefined && input.amountMicroRub < order.amountMicroRub
        ? "PARTIAL_REFUNDED"
        : "REFUNDED";
    return this.getState(input.providerPaymentId);
  }

  succeed(providerPaymentId: string): MockPaymentEvent {
    this.mark(providerPaymentId, "CONFIRMED");
    return this.event(providerPaymentId, "payment.succeeded");
  }

  fail(providerPaymentId: string): MockPaymentEvent {
    this.mark(providerPaymentId, "REJECTED");
    return this.event(providerPaymentId, "payment.failed");
  }

  refund(providerPaymentId: string): MockPaymentEvent {
    this.mark(providerPaymentId, "REFUNDED");
    return this.event(providerPaymentId, "payment.refunded");
  }

  private mark(providerPaymentId: string, status: string): void {
    const order = this.byProviderId.get(providerPaymentId);
    if (order) {
      order.status = status;
    }
  }

  private event(
    providerPaymentId: string,
    eventType: MockPaymentEvent["eventType"],
  ): MockPaymentEvent {
    return {
      provider: MOCK_PAYMENT_PROVIDER_ID,
      providerPaymentId,
      providerEventId: `${providerPaymentId}:${eventType}`,
      eventType,
    };
  }
}

function mockPaymentPageUrl(successUrl: string): string {
  const url = new URL(successUrl);
  const paymentId = url.searchParams.get("paymentId");
  const mock = new URL("/payment/mock", url.origin);
  if (paymentId) {
    mock.searchParams.set("paymentId", paymentId);
  }
  return mock.toString();
}
