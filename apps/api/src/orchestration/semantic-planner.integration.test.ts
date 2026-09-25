import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { ApiTelemetrySink } from "../observability/telemetry.js";
import { OrchestrationService } from "./orchestration.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("semantic planner Vimla Core integration", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let server: Server;
  let baseUrl = "";
  let capturedPrompt = "";
  let responseDelayMs = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages: Array<{ content: string }>;
        };
        capturedPrompt = body.messages[0]?.content ?? "";

        const mentions = plannerMentions(capturedPrompt);
        const first = mentions[0];
        const second = mentions[1];
        if (!first || !second) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "missing mentions" }));
          return;
        }

        const draft = {
          schemaVersion: 1,
          decision: "PLAN",
          confidence: 0.97,
          clarificationQuestion: null,
          goal: "Create a campaign prompt and use its artifact in the second model",
          invocations: [
            {
              id: "author",
              purpose: "Create the campaign prompt using the frozen architecture context",
              targetHint: {
                kind: "MENTION",
                occurrenceId: first.occurrenceId,
                semanticRole: "EXECUTION",
              },
              outputs: [{ name: "prompt", artifactType: "PROMPT" }],
              acceptanceCriteria: [],
              riskHint: "READ_ONLY",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
            },
            {
              id: "writer",
              purpose: "Write the final campaign copy from the prompt artifact",
              targetHint: {
                kind: "MENTION",
                occurrenceId: second.occurrenceId,
                semanticRole: "EXECUTION",
              },
              outputs: [{ name: "copy", artifactType: "TEXT" }],
              acceptanceCriteria: [],
              riskHint: "READ_ONLY",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
            },
          ],
          dependencies: [
            {
              id: "prompt-copy",
              fromInvocationId: "author",
              toInvocationId: "writer",
              condition: { kind: "DATA" },
              inputBindings: [
                {
                  inputName: "prompt",
                  sourceOutputName: "prompt",
                  expectedArtifactType: "PROMPT",
                },
              ],
            },
          ],
        };

        const send = (): void => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(draft) } }],
            }),
          );
        };
        if (responseDelayMs > 0) {
          setTimeout(send, responseDelayMs);
        } else {
          send();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve semantic planner test server");
    }
    baseUrl = `http://127.0.0.1:${address.port}/v1`;

    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.OPERATOR_ENABLED = "true";
    process.env.SEMANTIC_PLANNER_PROVIDER = "internal-http";
    process.env.SEMANTIC_PLANNER_BASE_URL = baseUrl;
    process.env.SEMANTIC_PLANNER_MODEL = "test-planner";

    prisma = createPrismaClient(testDatabaseUrl);
    app = await createVimlaApiApp(loadApiConfig(process.env), { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("freezes context before the model call and persists the inferred data-flow", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        id: `semantic-core-${suffix}`,
        email: `${suffix}@semantic-core.test`,
        name: "Semantic Core Test",
        emailVerified: true,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Semantic core" },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "Earlier architecture choice: keep provider integrations behind ports and adapters.",
        status: "COMPLETE",
      },
    });
    const source = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content:
          "@gpt-5-6-luna prepare the campaign prompt; @claude-haiku-4-5 owns the final copy using that artifact",
        status: "COMPLETE",
      },
    });

    const service = app.get(OrchestrationService);
    const telemetry = app.get(ApiTelemetrySink);
    const emit = vi.spyOn(telemetry, "emit");
    const correlationId = randomUUID();
    const result = await service.planMessage(
      user.id,
      source.id,
      [
        {
          id: "mention-author",
          handleId: "handle-author",
          kind: "AI_MODEL",
          targetId: "model-author",
          canonicalHandle: "gpt-5-6-luna",
          startOffset: 0,
          endOffset: 15,
        },
        {
          id: "mention-writer",
          handleId: "handle-writer",
          kind: "AI_MODEL",
          targetId: "model-writer",
          canonicalHandle: "claude-haiku-4-5",
          startOffset: 45,
          endOffset: 63,
        },
      ],
      correlationId,
    );

    expect(result.kind).toBe("PLANNED");
    if (result.kind !== "PLANNED") {
      throw new Error("Expected semantic workflow to be planned");
    }
    expect(result.plan.invocations).toHaveLength(2);
    expect(result.plan.dependencies).toEqual([
      {
        id: "edge-01",
        fromInvocationId: "step-01",
        toInvocationId: "step-02",
        condition: { kind: "DATA" },
        inputBindings: [
          {
            inputName: "prompt",
            sourceOutputName: "prompt",
            expectedArtifactType: "PROMPT",
          },
        ],
      },
    ]);
    expect(capturedPrompt).toContain("PLANNING_CONTEXT:");
    expect(capturedPrompt).toContain("Earlier architecture choice");
    expect(capturedPrompt).toContain("ports and adapters");

    const snapshot = await prisma.contextSnapshot.findUnique({
      where: { planId: result.plan.id },
      include: { items: true },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.createdAt.getTime()).toBeLessThanOrEqual(
      result.plan.updatedAt ? new Date(result.plan.updatedAt).getTime() : Date.now(),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "planner.completed",
        correlationId,
        planId: result.plan.id,
        outcome: "SUCCESS",
        nodeCount: 2,
        edgeCount: 1,
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "context.snapshot",
        planId: result.plan.id,
        outcome: "SUCCESS",
        itemCount: expect.any(Number),
        metadataBytes: expect.any(Number),
      }),
    );
    emit.mockRestore();
  });

  it("returns the durable canceled plan when Stop wins the finalize race", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        id: `semantic-stop-race-${suffix}`,
        email: `${suffix}@semantic-stop-race.test`,
        name: "Semantic Stop Race",
        emailVerified: true,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Semantic stop race" },
    });
    const source = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content:
          "@gpt-5-6-luna prepare STOP_RACE input; @claude-haiku-4-5 use it",
        status: "COMPLETE",
      },
    });

    const service = app.get(OrchestrationService);
    let resolvePlanning!: (planId: string) => void;
    const planningPlanId = new Promise<string>((resolve) => {
      resolvePlanning = resolve;
    });
    responseDelayMs = 150;
    try {
      const planning = service.planMessage(
        user.id,
        source.id,
        [
          {
            id: "stop-race-a",
            handleId: "handle-a",
            kind: "AI_MODEL",
            targetId: "model-a",
            canonicalHandle: "gpt-5-6-luna",
            startOffset: 0,
            endOffset: 13,
          },
          {
            id: "stop-race-b",
            handleId: "handle-b",
            kind: "AI_MODEL",
            targetId: "model-b",
            canonicalHandle: "claude-haiku-4-5",
            startOffset: 39,
            endOffset: 56,
          },
        ],
        randomUUID(),
        (planId) => resolvePlanning(planId),
      );

      const planId = await planningPlanId;
      const stopped = await service.stop(user.id, planId);
      expect(stopped.status).toBe("CANCELED");

      const result = await planning;
      expect(result.kind).toBe("EXISTING_PLAN");
      if (result.kind !== "EXISTING_PLAN") {
        throw new Error("Expected terminal replay after Stop");
      }
      expect(result.plan.id).toBe(planId);
      expect(result.plan.status).toBe("CANCELED");
    } finally {
      responseDelayMs = 0;
    }
  });

  it("persists a terminal FAILED shell when bounded planning context cannot be built safely", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        id: `semantic-context-bound-${suffix}`,
        email: `${suffix}@semantic-context-bound.test`,
        name: "Semantic Context Bound",
        emailVerified: true,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Semantic context bound" },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "x".repeat(70_000),
        status: "COMPLETE",
      },
    });
    const source = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "@gpt-5-6-luna use the prior context with @claude-haiku-4-5",
        status: "COMPLETE",
      },
    });

    const service = app.get(OrchestrationService);
    await expect(
      service.planMessage(
        user.id,
        source.id,
        [
          {
            id: "context-bound-a",
            handleId: "handle-a",
            kind: "AI_MODEL",
            targetId: "model-a",
            canonicalHandle: "gpt-5-6-luna",
            startOffset: 0,
            endOffset: 15,
          },
          {
            id: "context-bound-b",
            handleId: "handle-b",
            kind: "AI_MODEL",
            targetId: "model-b",
            canonicalHandle: "claude-haiku-4-5",
            startOffset: 43,
            endOffset: 61,
          },
        ],
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });

    const shell = await prisma.executionPlan.findUniqueOrThrow({
      where: { messageId: source.id },
      select: { status: true, completedAt: true },
    });
    expect(shell.status).toBe("FAILED");
    expect(shell.completedAt).not.toBeNull();
  });
});

function plannerMentions(
  prompt: string,
): Array<{ occurrenceId: string }> {
  const startToken = "PLANNER_MENTIONS:";
  const endToken = "PLANNING_CONTEXT:";
  const start = prompt.indexOf(startToken);
  const end = prompt.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) return [];
  const raw = prompt.slice(start + startToken.length, end).trim();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "occurrenceId" in item &&
      typeof (item as { occurrenceId?: unknown }).occurrenceId === "string"
    ) {
      return [{ occurrenceId: (item as { occurrenceId: string }).occurrenceId }];
    }
    return [];
  });
}
