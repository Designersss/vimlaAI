const MAX_SEMANTIC_PLANNER_HTTP_RESPONSE_BYTES = 256 * 1024;

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
 * configured through a dedicated internal planner endpoint.
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

      const payload = await readBoundedJsonResponse(response);
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


async function readBoundedJsonResponse(
  response: Response,
): Promise<OpenAiChatResponse> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SEMANTIC_PLANNER_HTTP_RESPONSE_BYTES
  ) {
    throw new Error("Semantic planner provider response exceeds the size limit");
  }

  if (!response.body) {
    throw new Error("Semantic planner provider returned an empty response body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SEMANTIC_PLANNER_HTTP_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Semantic planner provider response exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Semantic planner provider returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Semantic planner provider returned an invalid response envelope");
  }
  return parsed as OpenAiChatResponse;
}
