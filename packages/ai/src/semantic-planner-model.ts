export interface SemanticPlannerCompletionInput {
  prompt: string;
  correlationId: string;
  signal?: AbortSignal;
}

export interface OpenAiCompatibleSemanticPlannerConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

/**
 * Included/internal Semantic Planner transport.
 *
 * This adapter is deliberately separate from Vimla's paid external-AI
 * execution path: it has no billing/reservation/catalog dependency and is
 * configured through a dedicated Vimla Core endpoint.
 */
export class OpenAiCompatibleSemanticPlannerModel {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAiCompatibleSemanticPlannerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    if (!this.baseUrl) throw new Error("Semantic planner base URL is required");
    if (!config.model.trim()) throw new Error("Semantic planner model is required");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000) {
      throw new Error("Semantic planner timeout must be at least 1000ms");
    }
  }

  async complete(input: SemanticPlannerCompletionInput): Promise<string> {
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    } else {
      input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": input.correlationId,
            ...(this.config.apiKey
              ? { authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: "user", content: input.prompt }],
            temperature: 0,
            stream: false,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(
          `Semantic planner provider returned HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as OpenAiChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("Semantic planner provider returned an empty response");
      }
      return content;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
