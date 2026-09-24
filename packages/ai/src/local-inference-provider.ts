import { joinUrl } from "./http-transport.js";
import { OpenAiCompatSseParser } from "./sse.js";
import type {
  AiProvider,
  HttpFetch,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderStreamEvent,
} from "./types.js";

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_RESPONSE_BYTES = 32 * 1024;
const MAX_STREAM_RESPONSE_BYTES = 4 * 1024 * 1024;

export type LocalInferenceErrorCode =
  | "CANCELED"
  | "CIRCUIT_OPEN"
  | "INVALID_RESPONSE"
  | "OVERLOADED"
  | "REJECTED"
  | "TIMEOUT"
  | "UNAVAILABLE";

export class LocalInferenceError extends Error {
  constructor(
    readonly code: LocalInferenceErrorCode,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(`Local inference failed: ${code}`);
    this.name = "LocalInferenceError";
  }
}

export interface LocalInferenceCapabilityMatrix {
  text: true;
  streaming: true;
  toolUse: boolean;
  health: true;
  readiness: true;
  telemetry: true;
}

export interface LocalInferenceProviderConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRequestBytes: number;
  maxConcurrentRequests: number;
  maxQueueDepth: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerResetMs: number;
  toolUse: boolean;
  apiKey?: string;
  healthPath?: string;
  readinessPath?: string;
  telemetryPath?: string;
  fetchImpl?: HttpFetch;
}

export interface LocalInferenceProbe {
  ok: boolean;
  latencyMs: number;
}

export interface LocalInferenceTelemetry {
  gpuUtilizationPercent: number | null;
  gpuMemoryUsedBytes: number | null;
  gpuMemoryTotalBytes: number | null;
  providerQueueDepth: number | null;
  providerActiveRequests: number | null;
  adapterActiveRequests: number;
  adapterQueuedRequests: number;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
}

type QueueWaiter = {
  resolve: () => void;
};

type CircuitPermit = {
  generation: number;
  halfOpen: boolean;
};

export class LocalInferenceProvider implements AiProvider {
  readonly id = "vimla-local";
  readonly capabilityMatrix: LocalInferenceCapabilityMatrix;

  private readonly baseUrl: string;
  private readonly fetchImpl: HttpFetch;
  private readonly healthPath: string;
  private readonly readinessPath: string;
  private readonly telemetryPath: string;
  private activeRequests = 0;
  private readonly waiters: QueueWaiter[] = [];
  private consecutiveFailures = 0;
  private openUntilMs = 0;
  private halfOpenInFlight = false;
  private circuitGeneration = 0;

  constructor(private readonly config: LocalInferenceProviderConfig) {
    const parsedBase = new URL(config.baseUrl);
    if (
      (parsedBase.protocol !== "http:" && parsedBase.protocol !== "https:") ||
      parsedBase.username ||
      parsedBase.password ||
      parsedBase.search ||
      parsedBase.hash
    ) {
      throw new Error("Local inference base URL must be a clean http(s) URL");
    }
    assertPositiveInteger(config.timeoutMs, "timeoutMs");
    assertPositiveInteger(config.maxRequestBytes, "maxRequestBytes");
    assertPositiveInteger(config.maxConcurrentRequests, "maxConcurrentRequests");
    assertNonNegativeInteger(config.maxQueueDepth, "maxQueueDepth");
    assertPositiveInteger(
      config.circuitBreakerFailureThreshold,
      "circuitBreakerFailureThreshold",
    );
    assertPositiveInteger(config.circuitBreakerResetMs, "circuitBreakerResetMs");

    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.healthPath = config.healthPath ?? "health";
    this.readinessPath = config.readinessPath ?? "ready";
    this.telemetryPath = config.telemetryPath ?? "telemetry";
    this.capabilityMatrix = {
      text: true,
      streaming: true,
      toolUse: config.toolUse,
      health: true,
      readiness: true,
      telemetry: true,
    };
  }

  runtimeState(): Pick<
    LocalInferenceTelemetry,
    "adapterActiveRequests" | "adapterQueuedRequests" | "circuitState"
  > {
    return {
      adapterActiveRequests: this.activeRequests,
      adapterQueuedRequests: this.waiters.length,
      circuitState: this.circuitState(),
    };
  }

  async health(): Promise<LocalInferenceProbe> {
    return this.probe(this.healthPath);
  }

  async readiness(): Promise<LocalInferenceProbe> {
    if (this.circuitState() === "OPEN") {
      return { ok: false, latencyMs: 0 };
    }
    return this.probe(this.readinessPath);
  }

  async telemetry(): Promise<LocalInferenceTelemetry> {
    let response: Response;
    try {
      response = await this.fetchWithProbeTimeout(this.telemetryPath);
    } catch {
      throw new LocalInferenceError("UNAVAILABLE", true);
    }
    if (!response.ok) {
      discardResponseBody(response);
      throw new LocalInferenceError(
        response.status >= 500 ? "UNAVAILABLE" : "REJECTED",
        response.status >= 500,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = await readBoundedJson(response, MAX_PROBE_RESPONSE_BYTES);
    } catch (error: unknown) {
      if (error instanceof LocalInferenceError) throw error;
      throw new LocalInferenceError("UNAVAILABLE", true);
    }
    const record = asRecord(payload);
    if (!record) {
      throw new LocalInferenceError("INVALID_RESPONSE", true);
    }
    const runtime = this.runtimeState();
    return {
      gpuUtilizationPercent: optionalFiniteNumber(
        record.gpuUtilizationPercent,
        0,
        100,
      ),
      gpuMemoryUsedBytes: optionalNonNegativeInteger(record.gpuMemoryUsedBytes),
      gpuMemoryTotalBytes: optionalNonNegativeInteger(record.gpuMemoryTotalBytes),
      providerQueueDepth: optionalNonNegativeInteger(record.queueDepth),
      providerActiveRequests: optionalNonNegativeInteger(record.activeRequests),
      ...runtime,
    };
  }

  async streamChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    if (
      request.tools &&
      request.tools.length > 0 &&
      !this.capabilityMatrix.toolUse
    ) {
      throw new LocalInferenceError("REJECTED", false);
    }

    const payload = JSON.stringify({
      model: request.providerModelId,
      messages: request.messages.map(serializeProviderMessage),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: request.maxOutputTokens,
    });
    if (new TextEncoder().encode(payload).byteLength > this.config.maxRequestBytes) {
      throw new LocalInferenceError("REJECTED", false);
    }

    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = request.abortSignal
      ? AbortSignal.any([request.abortSignal, timeout])
      : timeout;

    let permit = this.claimCircuitPermission();
    try {
      await this.acquireSlot(signal);
    } catch (error: unknown) {
      this.releaseHalfOpenPermit(permit);
      throw error;
    }

    let slotReleased = false;
    const releaseSlotOnce = (): void => {
      if (slotReleased) return;
      slotReleased = true;
      this.releaseSlot();
    };

    try {
      permit = this.refreshCircuitPermit(permit);
    } catch (error: unknown) {
      releaseSlotOnce();
      this.releaseHalfOpenPermit(permit);
      throw error;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, "chat/completions"), {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-correlation-id": request.correlationId,
          ...(this.config.apiKey
            ? { authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: payload,
        signal,
      });
    } catch (error: unknown) {
      releaseSlotOnce();
      const classified = classifyTransportError(error, signal);
      if (classified.code === "CANCELED") {
        this.releaseHalfOpenPermit(permit);
      } else {
        this.recordFailure(permit);
      }
      throw classified;
    }

    if (signal.aborted) {
      releaseSlotOnce();
      discardResponseBody(response);
      this.releaseHalfOpenPermit(permit);
      throw classifyAbortSignal(signal);
    }

    if (!response.ok) {
      releaseSlotOnce();
      discardResponseBody(response);
      const error = classifyHttpError(response.status);
      if (error.retryable) this.recordFailure(permit);
      else this.recordSuccess(permit);
      throw error;
    }

    if (!response.body) {
      releaseSlotOnce();
      this.recordFailure(permit);
      throw new LocalInferenceError("INVALID_RESPONSE", true, response.status);
    }

    const providerRequestId =
      response.headers.get("x-request-id") ??
      response.headers.get("x-provider-request-id");

    const releaseOnAbort = (): void => {
      releaseSlotOnce();
      this.releaseHalfOpenPermit(permit);
    };
    signal.addEventListener("abort", releaseOnAbort, { once: true });
    if (signal.aborted) {
      releaseOnAbort();
    }

    return {
      providerRequestId,
      events: this.readStream(
        response.body,
        signal,
        permit,
        releaseSlotOnce,
        () => signal.removeEventListener("abort", releaseOnAbort),
      ),
    };
  }

  private async *readStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    permit: CircuitPermit,
    releaseSlot: () => void,
    removeAbortListener: () => void,
  ): AsyncIterable<ProviderStreamEvent> {
    const parser = new OpenAiCompatSseParser();
    const reader = body.getReader();
    let responseBytes = 0;
    let reachedPhysicalEof = false;
    const abortReader = (): void => {
      void reader.cancel(signal.reason).catch(() => undefined);
    };
    signal.addEventListener("abort", abortReader, { once: true });
    try {
      for (;;) {
        if (signal.aborted) {
          throw classifyAbortSignal(signal);
        }
        const { done, value } = await reader.read();
        if (signal.aborted) {
          throw classifyAbortSignal(signal);
        }
        if (done) {
          reachedPhysicalEof = true;
          const final = eventsThroughDone(parser.finish());
          this.recordSuccess(permit);
          yield* final.events;
          return;
        }
        if (value) {
          responseBytes += value.byteLength;
          if (responseBytes > MAX_STREAM_RESPONSE_BYTES) {
            throw new LocalInferenceError("INVALID_RESPONSE", true);
          }
          const parsed = eventsThroughDone(parser.push(value));
          if (parsed.terminal) {
            this.recordSuccess(permit);
          }
          yield* parsed.events;
          if (parsed.terminal) {
            return;
          }
        }
      }
    } catch (error: unknown) {
      const classified =
        error instanceof SyntaxError
          ? new LocalInferenceError("INVALID_RESPONSE", true)
          : classifyTransportError(error, signal);
      if (classified.code === "CANCELED") {
        this.releaseHalfOpenPermit(permit);
      } else {
        this.recordFailure(permit);
      }
      throw classified;
    } finally {
      signal.removeEventListener("abort", abortReader);
      if (!reachedPhysicalEof) {
        void reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
      removeAbortListener();
      releaseSlot();
      this.releaseHalfOpenPermit(permit);
    }
  }

  private async probe(path: string): Promise<LocalInferenceProbe> {
    const started = Date.now();
    try {
      const response = await this.fetchWithProbeTimeout(path);
      const ok = response.ok;
      discardResponseBody(response);
      return {
        ok,
        latencyMs: Math.max(0, Date.now() - started),
      };
    } catch {
      return {
        ok: false,
        latencyMs: Math.max(0, Date.now() - started),
      };
    }
  }

  private fetchWithProbeTimeout(path: string): Promise<Response> {
    const signal = AbortSignal.timeout(
      Math.min(this.config.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS),
    );
    return this.fetchImpl(joinUrl(this.baseUrl, path), {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        ...(this.config.apiKey
          ? { authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      signal,
    });
  }

  private claimCircuitPermission(): CircuitPermit {
    const now = Date.now();
    if (this.openUntilMs > now) {
      throw new LocalInferenceError("CIRCUIT_OPEN", true);
    }
    if (this.openUntilMs > 0) {
      if (this.halfOpenInFlight) {
        throw new LocalInferenceError("CIRCUIT_OPEN", true);
      }
      this.halfOpenInFlight = true;
      return {
        generation: this.circuitGeneration,
        halfOpen: true,
      };
    }
    return {
      generation: this.circuitGeneration,
      halfOpen: false,
    };
  }

  private refreshCircuitPermit(permit: CircuitPermit): CircuitPermit {
    if (permit.generation === this.circuitGeneration) {
      return permit;
    }
    this.releaseHalfOpenPermit(permit);
    return this.claimCircuitPermission();
  }

  private recordSuccess(permit: CircuitPermit): void {
    if (permit.generation !== this.circuitGeneration) return;
    if (permit.halfOpen) {
      this.consecutiveFailures = 0;
      this.openUntilMs = 0;
      this.halfOpenInFlight = false;
      this.circuitGeneration += 1;
      return;
    }
    if (this.openUntilMs === 0) {
      this.consecutiveFailures = 0;
    }
  }

  private recordFailure(permit: CircuitPermit): void {
    if (permit.generation !== this.circuitGeneration) return;
    if (permit.halfOpen) {
      this.openCircuit();
      return;
    }

    this.consecutiveFailures += 1;
    if (
      this.consecutiveFailures >= this.config.circuitBreakerFailureThreshold
    ) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.openUntilMs = Date.now() + this.config.circuitBreakerResetMs;
    this.halfOpenInFlight = false;
    this.circuitGeneration += 1;
  }

  private releaseHalfOpenPermit(permit: CircuitPermit): void {
    if (
      permit.halfOpen &&
      permit.generation === this.circuitGeneration &&
      this.openUntilMs > 0
    ) {
      this.halfOpenInFlight = false;
    }
  }

  private circuitState(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    if (this.openUntilMs === 0) return "CLOSED";
    if (this.openUntilMs > Date.now()) return "OPEN";
    return "HALF_OPEN";
  }

  private async acquireSlot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw classifyAbortSignal(signal);
    }
    if (this.activeRequests < this.config.maxConcurrentRequests) {
      this.activeRequests += 1;
      return;
    }
    if (this.waiters.length >= this.config.maxQueueDepth) {
      throw new LocalInferenceError("OVERLOADED", true);
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        removeWaiter();
        cleanup();
        reject(classifyAbortSignal(signal));
      };

      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };

      const waiter: QueueWaiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          cleanup();
          this.activeRequests += 1;
          resolve();
        },
      };

      const removeWaiter = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      waiter.resolve();
      return;
    }
  }
}

function eventsThroughDone(events: ProviderStreamEvent[]): {
  events: ProviderStreamEvent[];
  terminal: boolean;
} {
  const doneIndex = events.findIndex((event) => event.type === "done");
  if (doneIndex === -1) {
    return { events, terminal: false };
  }
  return {
    events: events.slice(0, doneIndex + 1),
    terminal: true,
  };
}

function serializeProviderMessage(
  message: ProviderChatRequest["messages"][number],
): Record<string, unknown> {
  if (message.role === "tool") {
    if (!message.toolCallId) {
      throw new LocalInferenceError("REJECTED", false);
    }
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  }
  return {
    role: message.role,
    content: message.content,
  };
}

function classifyHttpError(status: number): LocalInferenceError {
  if (status === 408 || status === 429 || status >= 500) {
    return new LocalInferenceError(
      status === 408 ? "TIMEOUT" : "UNAVAILABLE",
      true,
      status,
    );
  }
  return new LocalInferenceError("REJECTED", false, status);
}

function classifyTransportError(
  error: unknown,
  signal: AbortSignal,
): LocalInferenceError {
  if (error instanceof LocalInferenceError) return error;
  if (signal.aborted) {
    return classifyAbortSignal(signal);
  }
  return new LocalInferenceError("UNAVAILABLE", true);
}

function classifyAbortSignal(signal: AbortSignal): LocalInferenceError {
  const reason = signal.reason;
  if (reason instanceof DOMException && reason.name === "TimeoutError") {
    return new LocalInferenceError("TIMEOUT", true);
  }
  return new LocalInferenceError("CANCELED", false);
}

function discardResponseBody(response: Response): void {
  if (!response.body) return;
  void response.body.cancel().catch(() => undefined);
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.body) {
    throw new LocalInferenceError("INVALID_RESPONSE", true);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new LocalInferenceError("INVALID_RESPONSE", true);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new LocalInferenceError("INVALID_RESPONSE", true);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalFiniteNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new LocalInferenceError("INVALID_RESPONSE", true);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new LocalInferenceError("INVALID_RESPONSE", true);
  }
  return value;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}
