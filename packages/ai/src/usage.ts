import { AiError } from "./errors.js";
import type { NormalizedUsage } from "./types.js";

export function normalizeProviderUsage(input: {
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens?: bigint;
  cacheReadTokens?: bigint;
  cacheWriteTokens?: bigint;
}): NormalizedUsage {
  const usage: NormalizedUsage = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens ?? 0n,
    cacheReadTokens: input.cacheReadTokens ?? 0n,
    cacheWriteTokens: input.cacheWriteTokens ?? 0n,
  };

  if (
    usage.inputTokens < 0n ||
    usage.outputTokens < 0n ||
    usage.reasoningTokens < 0n ||
    usage.cacheReadTokens < 0n ||
    usage.cacheWriteTokens < 0n
  ) {
    throw new AiError("PROVIDER_USAGE_INVALID", "Provider usage contained negative tokens", 500);
  }

  if (usage.cacheReadTokens > usage.inputTokens) {
    throw new AiError(
      "PROVIDER_USAGE_INVALID",
      "cacheReadTokens cannot exceed inputTokens",
      500,
    );
  }

  if (usage.cacheWriteTokens > usage.inputTokens) {
    throw new AiError(
      "PROVIDER_USAGE_INVALID",
      "cacheWriteTokens cannot exceed inputTokens",
      500,
    );
  }

  if (usage.reasoningTokens > usage.outputTokens) {
    throw new AiError(
      "PROVIDER_USAGE_INVALID",
      "reasoningTokens cannot exceed outputTokens",
      500,
    );
  }

  return usage;
}

export function readOpenAiUsage(payload: unknown): NormalizedUsage | null {
  if (typeof payload !== "object" || payload === null || !("usage" in payload)) {
    return null;
  }

  const usage = payload.usage;
  if (typeof usage !== "object" || usage === null) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  if (!("prompt_tokens" in record) && !("completion_tokens" in record)) {
    return null;
  }

  const details =
    record.prompt_tokens_details && typeof record.prompt_tokens_details === "object"
      ? (record.prompt_tokens_details as Record<string, unknown>)
      : {};
  const completionDetails =
    record.completion_tokens_details && typeof record.completion_tokens_details === "object"
      ? (record.completion_tokens_details as Record<string, unknown>)
      : {};

  return normalizeProviderUsage({
    inputTokens: asTokenCount(record.prompt_tokens),
    outputTokens: asTokenCount(record.completion_tokens),
    reasoningTokens: asTokenCount(completionDetails.reasoning_tokens, true),
    cacheReadTokens: asTokenCount(details.cached_tokens, true),
    cacheWriteTokens: asTokenCount(details.cache_write_tokens ?? details.cache_creation_tokens, true),
  });
}

function asTokenCount(value: unknown, optional = false): bigint {
  if (value === undefined || value === null) {
    if (optional) {
      return 0n;
    }
    throw new AiError("PROVIDER_USAGE_INVALID", "Provider usage is missing token counts", 500);
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  throw new AiError("PROVIDER_USAGE_INVALID", "Provider usage token count is not an integer", 500);
}
