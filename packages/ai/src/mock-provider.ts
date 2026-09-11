import type { AiProvider, NormalizedUsage, ProviderChatRequest, ProviderChatResult, ProviderStreamEvent } from "./types.js";
import { ProviderCallError } from "./types.js";
import { isOperatorPlannerPrompt, mockOperatorPlannerResponse } from "./mock-operator-plan.js";

export type MockProviderScenario =
  | "success"
  | "missing-usage"
  | "expensive"
  | "reject"
  | "balance"
  | "ambiguous";

export class MockAiProvider implements AiProvider {
  readonly id = "mock";
  callCount = 0;
  lastRequest: ProviderChatRequest | null = null;
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
    const replyText =
      isOperatorPlannerPrompt(request.messages) && this.scenario === "success"
        ? mockOperatorPlannerResponse(request.messages)
        : this.text;
    if (this.delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
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

    return {
      providerRequestId: "mock-provider-request",
      events: emitMockEvents(text, usage, includeUsage, split),
    };
  }
}

async function* emitMockEvents(
  text: string,
  usage: NormalizedUsage,
  includeUsage: boolean,
  split: boolean,
): AsyncIterable<ProviderStreamEvent> {
  if (split && text.length > 1) {
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
