const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export interface OpenAiCompatibleJsonChatMessage {
  role: "system" | "user";
  content: string;
}

export interface OpenAiJsonChatAbortSignal {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface OpenAiCompatibleJsonChatConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAiCompatibleJsonChatInput {
  messages: readonly OpenAiCompatibleJsonChatMessage[];
  headers?: Readonly<Record<string, string>>;
  signal?: OpenAiJsonChatAbortSignal;
}

export class OpenAiCompatibleJsonChatHttpError extends Error {
  readonly retryable: boolean;

  constructor(readonly status: number) {
    super(`OpenAI-compatible provider returned HTTP ${status}`);
    this.name = "OpenAiCompatibleJsonChatHttpError";
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class OpenAiCompatibleJsonChatResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiCompatibleJsonChatResponseError";
  }
}

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export class OpenAiCompatibleJsonChatTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;

  constructor(private readonly config: OpenAiCompatibleJsonChatConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxResponseBytes =
      config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

    if (!this.baseUrl) {
      throw new Error("OpenAI-compatible base URL is required");
    }
    if (!config.model.trim()) {
      throw new Error("OpenAI-compatible model is required");
    }
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000) {
      throw new Error("OpenAI-compatible timeout must be at least 1000ms");
    }
    if (
      !Number.isInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1_024
    ) {
      throw new Error(
        "OpenAI-compatible response limit must be at least 1024 bytes",
      );
    }
  }

  async complete(input: OpenAiCompatibleJsonChatInput): Promise<string> {
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
            ...input.headers,
            ...(this.config.apiKey
              ? { authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: input.messages,
            temperature: 0,
            stream: false,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new OpenAiCompatibleJsonChatHttpError(response.status);
      }

      const payload = await readBoundedJsonResponse(
        response,
        this.maxResponseBytes,
      );
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new OpenAiCompatibleJsonChatResponseError(
          "OpenAI-compatible provider returned an empty response",
        );
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
  maxBytes: number,
): Promise<OpenAiChatResponse> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new OpenAiCompatibleJsonChatResponseError(
      "OpenAI-compatible provider response exceeds the size limit",
    );
  }
  if (!response.body) {
    throw new OpenAiCompatibleJsonChatResponseError(
      "OpenAI-compatible provider returned an empty response body",
    );
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
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new OpenAiCompatibleJsonChatResponseError(
          "OpenAI-compatible provider response exceeds the size limit",
        );
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
    throw new OpenAiCompatibleJsonChatResponseError(
      "OpenAI-compatible provider returned invalid JSON",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OpenAiCompatibleJsonChatResponseError(
      "OpenAI-compatible provider returned an invalid response envelope",
    );
  }
  return parsed as OpenAiChatResponse;
}
