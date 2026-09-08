import { createHash } from "node:crypto";
import type { VerifiedTBankNotification } from "./tbank-provider.js";
import { classifyTBankStatus } from "./payment-states.js";
import type { PaymentEventInput } from "./types.js";

export function tbankNotificationFingerprint(notification: VerifiedTBankNotification): string {
  const canonical = [
    notification.orderId,
    notification.paymentId,
    notification.status,
    notification.amountMicroRub.toString(10),
    notification.success ? "true" : "false",
  ].join(":");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function paymentEventFromNotification(
  provider: string,
  notification: VerifiedTBankNotification,
): PaymentEventInput {
  const moneyEvent = classifyTBankStatus(notification.status);
  let eventType: PaymentEventInput["eventType"] = "payment.status";
  if (moneyEvent === "confirmed") {
    eventType = "payment.succeeded";
  } else if (moneyEvent === "failed") {
    eventType = "payment.failed";
  } else if (moneyEvent === "canceled") {
    eventType = "payment.canceled";
  } else if (moneyEvent === "refunded") {
    eventType = "payment.refunded";
  } else if (moneyEvent === "partially_refunded") {
    eventType = "payment.partially_refunded";
  }

  return {
    provider,
    providerEventId: tbankNotificationFingerprint(notification),
    providerPaymentId: notification.paymentId,
    orderId: notification.orderId,
    eventType,
    providerStatus: notification.status,
    amountMicroRub: notification.amountMicroRub,
    paymentMethod: notification.paymentMethod,
    rawProviderPaymentMethod: notification.rawProviderSource,
  };
}
