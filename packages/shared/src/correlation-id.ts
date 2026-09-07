import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";

export function createCorrelationId(): string {
  return randomUUID();
}

export function readCorrelationId(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const requestId = firstHeaderValue(headers[REQUEST_ID_HEADER]);
  if (requestId !== undefined) {
    return requestId;
  }

  return firstHeaderValue(headers[CORRELATION_ID_HEADER]);
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string") {
      const trimmed = first.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }

  return undefined;
}
