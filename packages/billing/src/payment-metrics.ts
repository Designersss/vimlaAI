export interface PaymentMetricsSnapshot {
  checkoutCreated: number;
  paymentConfirmed: number;
  paymentFailed: number;
  webhookInvalidSignature: number;
  webhookDuplicate: number;
  reconciliationSuccess: number;
  reconciliationFailure: number;
  refund: number;
  refundAnomaly: number;
  providerLatencyMsTotal: number;
  providerCalls: number;
  providerErrors: number;
}

export class PaymentMetrics {
  private checkoutCreated = 0;
  private paymentConfirmed = 0;
  private paymentFailed = 0;
  private webhookInvalidSignature = 0;
  private webhookDuplicate = 0;
  private reconciliationSuccess = 0;
  private reconciliationFailure = 0;
  private refund = 0;
  private refundAnomaly = 0;
  private providerLatencyMsTotal = 0;
  private providerCalls = 0;
  private providerErrors = 0;

  recordCheckoutCreated(): void {
    this.checkoutCreated += 1;
  }

  recordConfirmed(): void {
    this.paymentConfirmed += 1;
  }

  recordFailed(): void {
    this.paymentFailed += 1;
  }

  recordInvalidSignature(): void {
    this.webhookInvalidSignature += 1;
  }

  recordDuplicateWebhook(): void {
    this.webhookDuplicate += 1;
  }

  recordReconciliation(success: boolean): void {
    if (success) {
      this.reconciliationSuccess += 1;
    } else {
      this.reconciliationFailure += 1;
    }
  }

  recordRefund(anomaly: boolean): void {
    this.refund += 1;
    if (anomaly) {
      this.refundAnomaly += 1;
    }
  }

  recordProviderCall(latencyMs: number, error: boolean): void {
    this.providerCalls += 1;
    this.providerLatencyMsTotal += latencyMs;
    if (error) {
      this.providerErrors += 1;
    }
  }

  snapshot(): PaymentMetricsSnapshot {
    return {
      checkoutCreated: this.checkoutCreated,
      paymentConfirmed: this.paymentConfirmed,
      paymentFailed: this.paymentFailed,
      webhookInvalidSignature: this.webhookInvalidSignature,
      webhookDuplicate: this.webhookDuplicate,
      reconciliationSuccess: this.reconciliationSuccess,
      reconciliationFailure: this.reconciliationFailure,
      refund: this.refund,
      refundAnomaly: this.refundAnomaly,
      providerLatencyMsTotal: this.providerLatencyMsTotal,
      providerCalls: this.providerCalls,
      providerErrors: this.providerErrors,
    };
  }
}
