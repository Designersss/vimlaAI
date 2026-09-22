import { describe, expect, it } from "vitest";
import {
  AiEvaluationProviderError,
  AiEvaluationResponseError,
  AiEvaluationUnavailableError,
  DisabledAiEvaluationModel,
  OpenAiCompatibleAiEvaluationModel,
} from "./evaluator-invocation-executor.js";

const input = {
  purpose: "Evaluate candidate",
  criteria: [
    {
      id: "quality",
      description: "Candidate meets the quality bar",
      mode: "AI_EVALUATOR" as const,
    },
  ],
  artifacts: [
    {
      inputName: "candidate",
      type: "TEXT",
      content: {
        kind: "INLINE_JSON" as const,
        value: { text: "candidate" },
      },
    },
  ],
};

describe("AI evaluator model boundary", () => {
  it("fails closed when the internal evaluator is disabled", async () => {
    await expect(new DisabledAiEvaluationModel().evaluate(input)).rejects.toBeInstanceOf(
      AiEvaluationUnavailableError,
    );
  });

  it("parses a strict internal evaluator response", async () => {
    const model = new OpenAiCompatibleAiEvaluationModel({
      baseUrl: "http://evaluator.internal/v1",
      model: "evaluator",
      timeoutMs: 5_000,
      fetchImpl: (async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        expect(request.messages[1]?.content).toContain("Candidate meets the quality bar");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    mode: "AI_EVALUATOR",
                    outcome: "PASS",
                    confidence: 0.82,
                    criteriaResults: [
                      {
                        criterionId: "quality",
                        outcome: "PASS",
                        confidence: 0.82,
                        summary: "Meets the quality bar.",
                      },
                    ],
                    summary: "Accepted.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    await expect(model.evaluate(input)).resolves.toEqual({
      mode: "AI_EVALUATOR",
      outcome: "PASS",
      confidence: 0.82,
      criteriaResults: [
        {
          criterionId: "quality",
          outcome: "PASS",
          confidence: 0.82,
          summary: "Meets the quality bar.",
        },
      ],
      summary: "Accepted.",
    });
  });

  it("treats invalid model output as a terminal response-contract error", async () => {
    const model = new OpenAiCompatibleAiEvaluationModel({
      baseUrl: "http://evaluator.internal/v1",
      model: "evaluator",
      timeoutMs: 5_000,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{not-json" } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    await expect(model.evaluate(input)).rejects.toBeInstanceOf(
      AiEvaluationResponseError,
    );
  });

  it("marks retryable and permanent provider HTTP failures distinctly", async () => {
    for (const [status, retryable] of [
      [503, true],
      [429, true],
      [401, false],
    ] as const) {
      const model = new OpenAiCompatibleAiEvaluationModel({
        baseUrl: "http://evaluator.internal/v1",
        model: "evaluator",
        timeoutMs: 5_000,
        fetchImpl: (async () => new Response("failed", { status })) as typeof fetch,
      });
      try {
        await model.evaluate(input);
        throw new Error("Expected provider failure");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AiEvaluationProviderError);
        expect((error as AiEvaluationProviderError).retryable).toBe(retryable);
      }
    }
  });

  it("rejects oversized provider responses before parsing", async () => {
    const model = new OpenAiCompatibleAiEvaluationModel({
      baseUrl: "http://evaluator.internal/v1",
      model: "evaluator",
      timeoutMs: 5_000,
      fetchImpl: (async () =>
        new Response("x".repeat(300 * 1024), { status: 200 })) as typeof fetch,
    });

    await expect(model.evaluate(input)).rejects.toBeInstanceOf(
      AiEvaluationResponseError,
    );
  });
});
