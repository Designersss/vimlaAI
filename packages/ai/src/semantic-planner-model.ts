import { OpenAiCompatibleJsonChatTransport } from "./openai-json-chat.js";

export interface SemanticPlannerCompletionInput {
  prompt: string;
  correlationId: string;
  signal?: {
    readonly aborted: boolean;
    addEventListener(
      type: "abort",
      listener: () => void,
      options?: { once?: boolean },
    ): void;
    removeEventListener(type: "abort", listener: () => void): void;
  };
}

export interface OpenAiCompatibleSemanticPlannerConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Included/internal Semantic Planner transport.
 *
 * This adapter is deliberately separate from Vimla's paid external-AI
 * execution path: it has no billing/reservation/catalog dependency and is
 * configured through a dedicated internal planner endpoint.
 */
export class OpenAiCompatibleSemanticPlannerModel {
  private readonly transport: OpenAiCompatibleJsonChatTransport;

  constructor(config: OpenAiCompatibleSemanticPlannerConfig) {
    this.transport = new OpenAiCompatibleJsonChatTransport(config);
  }

  async complete(input: SemanticPlannerCompletionInput): Promise<string> {
    return this.transport.complete({
      messages: [{ role: "user", content: input.prompt }],
      headers: { "x-correlation-id": input.correlationId },
      signal: input.signal,
    });
  }
}
