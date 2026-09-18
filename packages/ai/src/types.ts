import type { MicroRub } from "@vimla/billing";

export type ProviderChatRole = "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderChatMessage {
  role: ProviderChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: readonly ProviderToolCall[];
}

export interface ProviderChatRequest {
  providerModelId: string;
  messages: readonly ProviderChatMessage[];
  tools?: readonly ProviderToolDefinition[];
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
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta: string;
    }
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
