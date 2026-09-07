import { AiError } from "./errors.js";

const MESSAGE_OVERHEAD_BYTES = 24;
const SAFETY_BYTES = 32;

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Conservative model-agnostic estimator. 1 UTF-8 byte counts as 1 token so
 * Latin text is overestimated; this is a financial hold, not a tokenizer.
 * Actual provider usage is the settlement source of truth.
 */
export function estimateInputTokens(
  messages: ReadonlyArray<{ content: string }>,
): number {
  let bytes = SAFETY_BYTES;
  for (const message of messages) {
    bytes += utf8ByteLength(message.content) + MESSAGE_OVERHEAD_BYTES;
  }

  return bytes < 1 ? 1 : bytes;
}

export function assertMessageSize(content: string, maxBytes: number): void {
  if (utf8ByteLength(content) > maxBytes) {
    throw new AiError("MESSAGE_TOO_LARGE", "Message exceeds the configured size limit", 400);
  }
}

export function selectContextMessages<T extends { content: string }>(
  messages: readonly T[],
  maxContextBytes: number,
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const size = utf8ByteLength(message.content) + MESSAGE_OVERHEAD_BYTES;
    if (selected.length > 0 && used + size > maxContextBytes) {
      break;
    }

    selected.push(message);
    used += size;
  }

  return selected.reverse();
}
