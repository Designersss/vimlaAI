import { describe, expect, it } from "vitest";
import {
  LocalInferenceError,
  LocalInferenceProvider,
} from "./local-inference-provider.js";
import type { HttpFetch } from "./types.js";

function provider(
  fetchImpl: HttpFetch,
  overrides: Partial<ConstructorParameters<typeof LocalInferenceProvider>[0]> = {},
): LocalInferenceProvider {
  return new LocalInferenceProvider({
    baseUrl: "http://127.0.0.1:18080/v1",
    timeoutMs: 5_000,
    maxRequestBytes: 64 * 1024,
    maxConcurrentRequests: 2,
    maxQueueDepth: 2,
    circuitBreakerFailureThreshold: 2,
    circuitBreakerResetMs: 30_000,
    toolUse: true,
    fetchImpl,
    ...overrides,
  });
}

describe("LocalInferenceProvider", () => {
  it("normalizes streamed text, tool calls and usage without paid-provider coupling", async () => {
    let seenUrl = "";
    let seenBody = "";
    let seenRedirect: RequestRedirect | undefined;
    const fetchImpl: HttpFetch = async (url, init) => {
      seenUrl = url;
      seenBody = String(init.body ?? "");
      seenRedirect = init.redirect;
      const toolPayload = JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call-1",
              function: { name: "tasks.list", arguments: "{}" },
            }],
          },
        }],
      });
      return new Response(
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
          `data: ${toolPayload}\n\n` +
          'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
          "data: [DONE]\n\n",
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "local-1",
          },
        },
      );
    };
    const local = provider(fetchImpl);
    const result = await local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "hello" }],
      tools: [{
        name: "tasks.list",
        description: "list",
        inputSchema: {},
      }],
      maxOutputTokens: 128,
      correlationId: "corr-1",
    });
    const events = [];
    for await (const event of result.events) events.push(event);

    expect(seenUrl).toBe("http://127.0.0.1:18080/v1/chat/completions");
    expect(seenBody).toContain('"model":"qwen-local"');
    expect(seenRedirect).toBe("error");
    expect(result.providerRequestId).toBe("local-1");
    expect(events).toContainEqual({ type: "delta", text: "hello" });
    expect(events).toContainEqual({
      type: "tool_call_delta",
      index: 0,
      id: "call-1",
      name: "tasks.list",
      argumentsDelta: "{}",
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: {
        inputTokens: 5n,
        outputTokens: 2n,
        reasoningTokens: 0n,
        cacheReadTokens: 0n,
        cacheWriteTokens: 0n,
      },
    });
  });

  it("treats the OpenAI-compatible done event as terminal without reading for EOF", async () => {
    const encoder = new TextEncoder();
    let readCalls = 0;
    let canceled = false;
    let released = false;
    const reader = {
      read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        readCalls += 1;
        if (readCalls === 1) {
          return {
            done: false,
            value: encoder.encode(
              "data: [DONE]\n\n" +
                'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
            ),
          };
        }
        return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
      },
      cancel: async (): Promise<void> => {
        canceled = true;
      },
      releaseLock: (): void => {
        released = true;
      },
    };
    const body = {
      getReader: () => reader,
    } as unknown as ReadableStream<Uint8Array>;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body,
    } as Response;
    const local = provider(async () => response);
    const result = await local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-done",
    });
    const events = [];
    for await (const event of result.events) events.push(event);

    expect(events).toEqual([{ type: "done" }]);
    expect(readCalls).toBe(1);
    expect(canceled).toBe(true);
    expect(released).toBe(true);
    expect(local.runtimeState().adapterActiveRequests).toBe(0);
  });

  it("exposes bounded health, readiness and GPU/queue telemetry", async () => {
    const probeRedirects: Array<RequestRedirect | undefined> = [];
    const fetchImpl: HttpFetch = async (url, init) => {
      probeRedirects.push(init.redirect);
      if (url.endsWith("/telemetry")) {
        return new Response(JSON.stringify({
          gpuUtilizationPercent: 73.5,
          gpuMemoryUsedBytes: 12_000,
          gpuMemoryTotalBytes: 24_000,
          queueDepth: 3,
          activeRequests: 2,
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const local = provider(fetchImpl);

    await expect(local.health()).resolves.toMatchObject({ ok: true });
    await expect(local.readiness()).resolves.toMatchObject({ ok: true });
    await expect(local.telemetry()).resolves.toMatchObject({
      gpuUtilizationPercent: 73.5,
      gpuMemoryUsedBytes: 12_000,
      gpuMemoryTotalBytes: 24_000,
      providerQueueDepth: 3,
      providerActiveRequests: 2,
      adapterActiveRequests: 0,
      adapterQueuedRequests: 0,
      circuitState: "CLOSED",
    });
    expect(probeRedirects).toEqual(["error", "error", "error"]);
    expect(local.capabilityMatrix).toEqual({
      text: true,
      streaming: true,
      toolUse: true,
      health: true,
      readiness: true,
      telemetry: true,
    });
  });

  it("rejects a successful HTTP response that contains no provider events", async () => {
    let calls = 0;
    const local = provider(async () => {
      calls += 1;
      return new Response("not an SSE event", { status: 200 });
    }, {
      circuitBreakerFailureThreshold: 1,
    });

    const request = {
      providerModelId: "qwen-local",
      messages: [{ role: "user" as const, content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-empty-stream",
    };

    const result = await local.streamChat(request);
    const drain = (async () => {
      for await (const _event of result.events) {
        // Drain the provider stream.
      }
    })();
    await expect(drain).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(local.runtimeState().circuitState).toBe("OPEN");
    await expect(local.streamChat({
      ...request,
      correlationId: "corr-empty-stream-blocked",
    })).rejects.toMatchObject({
      code: "CIRCUIT_OPEN",
      retryable: true,
    });
    expect(calls).toBe(1);
  });

  it("normalizes telemetry body failures instead of leaking transport errors", async () => {
    const fetchImpl: HttpFetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("internal transport detail"));
          },
        }),
        { status: 200 },
      );
    const local = provider(fetchImpl);

    await expect(local.telemetry()).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("enforces the local request timeout without exposing provider details", async () => {
    const fetchImpl: HttpFetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    const local = provider(fetchImpl, { timeoutMs: 10 });

    await expect(local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-timeout",
    })).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });
  });

  it("releases an abandoned stream concurrency slot when the request deadline expires", async () => {
    const fetchImpl: HttpFetch = async () =>
      new Response("data: [DONE]\n\n", { status: 200 });
    const local = provider(fetchImpl, {
      timeoutMs: 10,
      maxConcurrentRequests: 1,
      maxQueueDepth: 0,
    });

    await local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "abandoned" }],
      maxOutputTokens: 32,
      correlationId: "corr-abandoned",
    });
    expect(local.runtimeState().adapterActiveRequests).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(local.runtimeState().adapterActiveRequests).toBe(0);
  });

  it("opens its circuit after repeated retryable local failures", async () => {
    let calls = 0;
    const fetchImpl: HttpFetch = async () => {
      calls += 1;
      return new Response("{}", { status: 503 });
    };
    const local = provider(fetchImpl, {
      circuitBreakerFailureThreshold: 2,
    });
    const request = {
      providerModelId: "qwen-local",
      messages: [{ role: "user" as const, content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-circuit",
    };

    await expect(local.streamChat(request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    await expect(local.streamChat(request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    await expect(local.streamChat(request)).rejects.toMatchObject({
      code: "CIRCUIT_OPEN",
      retryable: true,
    });
    expect(calls).toBe(2);
    await expect(local.readiness()).resolves.toEqual({
      ok: false,
      latencyMs: 0,
    });
  });

  it("does not send a queued request after another request opens the circuit", async () => {
    let calls = 0;
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchImpl: HttpFetch = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
    };
    const local = provider(fetchImpl, {
      maxConcurrentRequests: 1,
      maxQueueDepth: 1,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 30_000,
    });
    const request = {
      providerModelId: "qwen-local",
      messages: [{ role: "user" as const, content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-queue-circuit",
    };

    const first = local.streamChat(request);
    await Promise.resolve();
    const queued = local.streamChat({
      ...request,
      correlationId: "corr-queued-after-open",
    });
    await Promise.resolve();

    resolveFirst?.(new Response("{}", { status: 503 }));

    await expect(first).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    await expect(queued).rejects.toMatchObject({
      code: "CIRCUIT_OPEN",
      retryable: true,
    });
    expect(calls).toBe(1);
  });

  it("does not let an older in-flight success close a circuit opened by another request", async () => {
    let calls = 0;
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchImpl: HttpFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Response("{}", { status: 503 });
    };
    const local = provider(fetchImpl, {
      maxConcurrentRequests: 2,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 30_000,
    });
    const request = {
      providerModelId: "qwen-local",
      messages: [{ role: "user" as const, content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-circuit-race",
    };

    const older = local.streamChat(request);
    await Promise.resolve();

    await expect(local.streamChat({
      ...request,
      correlationId: "corr-circuit-opener",
    })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });

    resolveFirst?.(new Response("data: [DONE]\n\n", { status: 200 }));
    const olderResult = await older;
    for await (const _event of olderResult.events) {
      // Drain the older request after the newer failure has opened the circuit.
    }

    expect(local.runtimeState().circuitState).toBe("OPEN");
    await expect(local.streamChat({
      ...request,
      correlationId: "corr-circuit-blocked",
    })).rejects.toMatchObject({
      code: "CIRCUIT_OPEN",
      retryable: true,
    });
    expect(calls).toBe(2);
  });

  it("releases a half-open circuit lease when a recovery stream is abandoned", async () => {
    let calls = 0;
    const fetchImpl: HttpFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("{}", { status: 503 });
      }
      return new Response("data: [DONE]\n\n", { status: 200 });
    };
    const local = provider(fetchImpl, {
      timeoutMs: 10,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 1,
      maxConcurrentRequests: 1,
      maxQueueDepth: 0,
    });
    const request = {
      providerModelId: "qwen-local",
      messages: [{ role: "user" as const, content: "hello" }],
      maxOutputTokens: 32,
      correlationId: "corr-half-open",
    };

    await expect(local.streamChat(request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await local.streamChat(request);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const recovered = await local.streamChat(request);
    for await (const _event of recovered.events) {
      // Drain the successful recovery stream.
    }

    expect(calls).toBe(3);
    expect(local.runtimeState().circuitState).toBe("CLOSED");
  });

  it("rejects unsupported tool use and oversized requests before network access", async () => {
    let calls = 0;
    const fetchImpl: HttpFetch = async () => {
      calls += 1;
      return new Response("data: [DONE]\n\n", { status: 200 });
    };
    const noTools = provider(fetchImpl, { toolUse: false });
    await expect(noTools.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "x", description: "x", inputSchema: {} }],
      maxOutputTokens: 32,
      correlationId: "corr-tools",
    })).rejects.toMatchObject({ code: "REJECTED" });

    const tiny = provider(fetchImpl, { maxRequestBytes: 32 });
    await expect(tiny.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "this request is intentionally too large" }],
      maxOutputTokens: 32,
      correlationId: "corr-size",
    })).rejects.toBeInstanceOf(LocalInferenceError);
    expect(calls).toBe(0);
  });

  it("fails fast when the bounded local queue is full", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchImpl: HttpFetch = async () =>
      new Promise<Response>((resolve) => {
        releaseFirst = () =>
          resolve(new Response("data: [DONE]\n\n", { status: 200 }));
      });
    const local = provider(fetchImpl, {
      maxConcurrentRequests: 1,
      maxQueueDepth: 0,
    });
    const firstPromise = local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "first" }],
      maxOutputTokens: 32,
      correlationId: "corr-first",
    });
    await Promise.resolve();

    await expect(local.streamChat({
      providerModelId: "qwen-local",
      messages: [{ role: "user", content: "second" }],
      maxOutputTokens: 32,
      correlationId: "corr-second",
    })).rejects.toMatchObject({ code: "OVERLOADED" });

    releaseFirst?.();
    const first = await firstPromise;
    for await (const _event of first.events) {
      // Drain the stream so the concurrency slot is released.
    }
  });
});
