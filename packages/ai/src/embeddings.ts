/** Included, operator-managed inference only. Paid adapters require separate admission/billing. */
export interface EmbeddingModel {
  readonly provider: string;
  readonly model: string;
  readonly revision: string;
  readonly dimensions: number;
}
export interface EmbeddingProvider {
  readonly identity: EmbeddingModel;
  embed(input: {
    texts: readonly string[];
    requestId: string;
  }): Promise<readonly number[][]>;
}
export class EmbeddingError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "INVALID_RESPONSE" | "UNAVAILABLE",
  ) {
    super(`Embedding service: ${code}`);
    this.name = "EmbeddingError";
  }
}
export function validateEmbedding(
  vector: unknown,
  dimensions: number,
): number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    !vector.every(
      (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6,
    )
  ) {
    throw new EmbeddingError("INVALID_RESPONSE");
  }
  const values = vector as number[];
  if (values.reduce((sum, v) => sum + v * v, 0) < 1e-20)
    throw new EmbeddingError("INVALID_RESPONSE");
  return values;
}
export interface InternalEmbeddingConfig {
  baseUrl: string;
  model: string;
  revision: string;
  dimensions: number;
  timeoutMs: number;
  apiKey?: string;
}
export class InternalHttpEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingModel;
  private readonly endpoint: string;
  constructor(
    private readonly config: InternalEmbeddingConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    const url = new URL(config.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !config.model.trim() ||
      !config.revision.trim() ||
      !Number.isInteger(config.dimensions) ||
      config.dimensions < 1 ||
      config.dimensions > 2000 ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 1000 ||
      config.timeoutMs > 30000
    )
      throw new EmbeddingError("INVALID_INPUT");
    this.endpoint = config.baseUrl.replace(/\/$/, "") + "/embeddings";
    this.identity = Object.freeze({
      provider: "internal-http",
      model: config.model,
      revision: config.revision,
      dimensions: config.dimensions,
    });
  }
  async embed(input: {
    texts: readonly string[];
    requestId: string;
  }): Promise<readonly number[][]> {
    if (
      input.texts.length < 1 ||
      input.texts.length > 32 ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.requestId) ||
      input.texts.some(
        (text) => !text.trim() || Buffer.byteLength(text) > 8192,
      ) ||
      input.texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) >
        65536
    )
      throw new EmbeddingError("INVALID_INPUT");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.transport(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.requestId,
          ...(this.config.apiKey
            ? { authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.identity.model,
          input: input.texts,
          encoding_format: "float",
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new EmbeddingError("UNAVAILABLE");
      }
      if (!response.body) throw new EmbeddingError("INVALID_RESPONSE");
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2_000_000) {
            await reader.cancel();
            throw new EmbeddingError("INVALID_RESPONSE");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (
        !isRecord(data) ||
        data.model !== this.identity.model ||
        !Array.isArray(data.data) ||
        data.data.length !== input.texts.length
      ) {
        throw new EmbeddingError("INVALID_RESPONSE");
      }
      const vectors: number[][] = new Array(input.texts.length);
      for (const row of data.data as unknown[]) {
        if (
          !isRecord(row) ||
          typeof row.index !== "number" ||
          !Number.isInteger(row.index) ||
          row.index < 0 ||
          row.index >= vectors.length ||
          vectors[row.index]
        )
          throw new EmbeddingError("INVALID_RESPONSE");
        vectors[row.index] = validateEmbedding(
          row.embedding,
          this.identity.dimensions,
        );
      }
      return vectors;
    } catch (error: unknown) {
      if (error instanceof EmbeddingError) throw error;
      throw new EmbeddingError("UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
