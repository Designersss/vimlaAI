import { randomUUID } from "node:crypto";

export const MOCK_PAYMENT_PROVIDER_ID = "mock";

export interface PaymentProvider {
  readonly id: string;
}

export interface MockPaymentEvent {
  provider: typeof MOCK_PAYMENT_PROVIDER_ID;
  providerPaymentId: string;
  providerEventId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.refunded";
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = MOCK_PAYMENT_PROVIDER_ID;

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

  succeed(providerPaymentId: string): MockPaymentEvent {
    return this.event(providerPaymentId, "payment.succeeded");
  }

  fail(providerPaymentId: string): MockPaymentEvent {
    return this.event(providerPaymentId, "payment.failed");
  }

  refund(providerPaymentId: string): MockPaymentEvent {
    return this.event(providerPaymentId, "payment.refunded");
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
