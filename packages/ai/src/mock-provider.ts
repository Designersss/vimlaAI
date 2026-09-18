import type {
  AiProvider,
  NormalizedUsage,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderStreamEvent,
  ProviderToolCall,
} from "./types.js";
import { ProviderCallError } from "./types.js";
import { isOperatorPlannerPrompt, mockOperatorPlannerResponse } from "./mock-operator-plan.js";

export type MockProviderScenario =
  | "success"
  | "missing-usage"
  | "expensive"
  | "reject"
  | "balance"
  | "ambiguous"
  | "usage-then-ambiguous";

export class MockAiProvider implements AiProvider {
  readonly id = "mock";
  callCount = 0;
  lastRequest: ProviderChatRequest | null = null;
  requests: ProviderChatRequest[] = [];
  toolCallQueue: ProviderToolCall[][] = [];
  scenario: MockProviderScenario = "success";
  usage: NormalizedUsage = {
    inputTokens: 18n,
    outputTokens: 8n,
    reasoningTokens: 0n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
  };
  text = "Hello from Vimla";
  splitDeltas = true;
  delayMs = 0;

  async streamChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    this.callCount += 1;
    this.lastRequest = request;
    this.requests.push(request);
    const replyText =
      isOperatorPlannerPrompt(request.messages) && this.scenario === "success"
        ? mockOperatorPlannerResponse(request.messages)
        : this.text;
    if (this.delayMs > 0) {
      await abortableDelay(this.delayMs, request.abortSignal);
    }

    if (this.scenario === "reject") {
      throw new ProviderCallError("rejected", "Mock provider rejected the request", 400);
    }

    if (this.scenario === "balance") {
      throw new ProviderCallError("balance", "Mock provider balance unavailable", 402);
    }

    if (this.scenario === "ambiguous") {
      throw new ProviderCallError("ambiguous", "Mock provider ambiguous failure", 504);
    }

    const usage = this.scenario === "expensive"
      ? {
          ...this.usage,
          outputTokens: 2_000_000n,
        }
      : this.usage;
    const includeUsage = this.scenario !== "missing-usage";
    const text = replyText;
    const split = this.splitDeltas;
    const toolCalls = this.toolCallQueue.shift() ?? [];

    return {
      providerRequestId: `mock-provider-request-${this.callCount}`,
      events:
        this.scenario === "usage-then-ambiguous"
          ? emitUsageThenAmbiguous(text, usage)
          : emitMockEvents(text, usage, includeUsage, split, toolCalls),
    };
  }
}

async function* emitUsageThenAmbiguous(
  text: string,
  usage: NormalizedUsage,
): AsyncIterable<ProviderStreamEvent> {
  if (text.length > 0) {
    yield { type: "delta", text };
  }
  yield { type: "usage", usage };
  throw new ProviderCallError(
    "ambiguous",
    "Mock provider interrupted after durable usage",
    504,
  );
}

async function* emitMockEvents(
  text: string,
  usage: NormalizedUsage,
  includeUsage: boolean,
  split: boolean,
  toolCalls: readonly ProviderToolCall[],
): AsyncIterable<ProviderStreamEvent> {
  if (toolCalls.length > 0) {
    for (const [index, call] of toolCalls.entries()) {
      yield {
        type: "tool_call_delta",
        index,
        id: call.id,
        name: call.name,
        argumentsDelta: JSON.stringify(call.arguments),
      };
    }
  } else if (split && text.length > 1) {
    const mid = Math.ceil(text.length / 2);
    yield { type: "delta", text: text.slice(0, mid) };
    yield { type: "delta", text: text.slice(mid) };
  } else {
    yield { type: "delta", text };
  }

  if (includeUsage) {
    yield { type: "usage", usage };
  }

  yield { type: "done" };
}


async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    throw new DOMException("Provider call aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Provider call aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
