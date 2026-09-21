import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleSemanticPlannerModel } from "./semantic-planner-model.js";

describe("OpenAiCompatibleSemanticPlannerModel", () => {
  it("calls the dedicated OpenAI-compatible internal planner endpoint", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://planner.internal/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        "x-correlation-id": "corr-1",
        authorization: "Bearer planner-secret",
      });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
        stream: boolean;
        response_format: { type: string };
      };
      expect(body).toEqual({
        model: "qwen-planner",
        messages: [{ role: "user", content: "planner prompt" }],
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" },
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"decision":"PLAN"}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const model = new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: "http://planner.internal/v1/",
      model: "qwen-planner",
      apiKey: "planner-secret",
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      model.complete({ prompt: "planner prompt", correlationId: "corr-1" }),
    ).resolves.toBe('{"decision":"PLAN"}');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts the provider request when orchestration loses the planning claim", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const model = new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: "http://planner.internal/v1",
      model: "planner",
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const completion = model.complete({
      prompt: "planner prompt",
      correlationId: "cancel-1",
      signal: caller.signal,
    });
    caller.abort();

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on provider errors and empty responses", async () => {
    const errorModel = new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: "http://planner.internal/v1",
      model: "planner",
      timeoutMs: 5_000,
      fetchImpl: (async () => new Response("no", { status: 503 })) as typeof fetch,
    });
    await expect(
      errorModel.complete({ prompt: "x", correlationId: "c" }),
    ).rejects.toThrow(/HTTP 503/);

    const emptyModel = new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: "http://planner.internal/v1",
      model: "planner",
      timeoutMs: 5_000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 200,
        })) as typeof fetch,
    });
    await expect(
      emptyModel.complete({ prompt: "x", correlationId: "c" }),
    ).rejects.toThrow(/empty response/);
  });
});
