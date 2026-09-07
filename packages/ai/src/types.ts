import type { MicroRub } from "@vimla/billing";

export type ProviderChatRole = "user" | "assistant";

export interface ProviderChatMessage {
  role: ProviderChatRole;
  content: string;
}

export interface ProviderChatRequest {
  providerModelId: string;
  messages: readonly ProviderChatMessage[];
  maxOutputTokens: number;
  correlationId: string;
  abortSignal?: AbortSignal;
}

export interface NormalizedUsage {
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
}

export type ProviderStreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: NormalizedUsage }
  | { type: "done" };

export interface ProviderChatResult {
  providerRequestId: string | null;
  events: AsyncIterable<ProviderStreamEvent>;
}

export interface AiProvider {
  readonly id: string;
  streamChat(request: ProviderChatRequest): Promise<ProviderChatResult>;
}

export interface PriceVersionQuote {
  inputMicroRubPerMillion: MicroRub;
  outputMicroRubPerMillion: MicroRub;
  cacheReadMicroRubPerMillion: MicroRub | null;
  cacheWriteMicroRubPerMillion: MicroRub | null;
}

export type ProviderFailureKind = "rejected" | "balance" | "ambiguous";

export class ProviderCallError extends Error {
  readonly kind: ProviderFailureKind;
  readonly httpStatus: number | null;

  constructor(kind: ProviderFailureKind, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "ProviderCallError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export type HttpFetch = (input: string, init: RequestInit) => Promise<Response>;
