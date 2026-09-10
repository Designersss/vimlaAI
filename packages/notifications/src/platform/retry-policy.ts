import type { NotificationErrorCategory } from "../types.js";
import { deliveryErrorCategory } from "../errors.js";

export type DeliveryErrorClass = "retryable" | "final" | "ambiguous";

const RETRYABLE_CATEGORIES = new Set<NotificationErrorCategory>(["network", "timeout", "abuse"]);
const FINAL_CATEGORIES = new Set<NotificationErrorCategory>(["rejected", "config"]);

export function classifyDeliveryError(error: unknown): {
  category: NotificationErrorCategory;
  errorClass: DeliveryErrorClass;
} {
  const category = deliveryErrorCategory(error);
  if (RETRYABLE_CATEGORIES.has(category)) {
    return { category, errorClass: "retryable" };
  }
  if (FINAL_CATEGORIES.has(category)) {
    return { category, errorClass: "final" };
  }
  return { category, errorClass: "ambiguous" };
}

export function nextAttemptAt(input: {
  attemptCount: number;
  now: Date;
  backoffBaseMs: number;
  backoffCapMs: number;
}): Date {
  const exp = Math.max(0, input.attemptCount - 1);
  const delay = Math.min(input.backoffCapMs, input.backoffBaseMs * 2 ** exp);
  const jitter = Math.floor(delay * 0.1 * Math.random());
  return new Date(input.now.getTime() + delay + jitter);
}

export function shouldRetry(input: {
  errorClass: DeliveryErrorClass;
  attemptCount: number;
  maxAttempts: number;
}): boolean {
  return input.errorClass === "retryable" && input.attemptCount < input.maxAttempts;
}
