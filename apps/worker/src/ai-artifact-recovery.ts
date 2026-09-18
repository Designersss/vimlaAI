import {
  ArtifactService,
  type ArtifactType,
} from "@vimla/artifacts";
import type { Prisma, PrismaClient } from "@vimla/database";
import type { RuntimeLogger } from "./orchestration.js";

const SUPPORTED_TEXT_TYPES = new Set<ArtifactType>([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "PLAN",
  "PATCH",
]);

export type AiArtifactRecoveryCounters = {
  scanned: number;
  recovered: number;
  errors: number;
};

export class AiArtifactRecovery {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: RuntimeLogger,
  ) {
    this.artifacts = new ArtifactService(prisma);
  }

  async recover(batchSize: number): Promise<AiArtifactRecoveryCounters> {
    const executions = await this.prisma.aIExecution.findMany({
      where: {
        invocationRun: {
          invocation: {
            artifacts: { none: {} },
          },
        },
        OR: [
          {
            aiRequest: {
              status: "SUCCEEDED",
              outputText: { not: null },
            },
          },
          {
            providerTurns: {
              some: {
                toolCallError: false,
                aiRequest: {
                  status: "SUCCEEDED",
                  outputText: { not: null },
                },
              },
            },
          },
        ],
      },
      include: {
        aiRequest: {
          include: { model: true },
        },
        providerTurns: {
          include: {
            aiRequest: {
              include: { model: true },
            },
          },
          orderBy: { turnIndex: "desc" },
        },
        invocationRun: {
          include: {
            invocation: {
              include: {
                plan: { select: { userId: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(batchSize, 500)),
    });

    const counters: AiArtifactRecoveryCounters = {
      scanned: executions.length,
      recovered: 0,
      errors: 0,
    };

    for (const execution of executions) {
      const invocation = execution.invocationRun.invocation;
      const request = selectRecoveryRequest(execution);
      if (!request) {
        continue;
      }

      try {
        const output = parseSingleTextOutput(invocation.outputDeclarations);
        await this.artifacts.createArtifact({
          actorUserId: invocation.plan.userId,
          creatorInvocationId: invocation.id,
          outputName: output.name,
          type: output.type,
          classification: "PRIVATE",
          content: {
            kind: "INLINE_JSON",
            value: { text: request.outputText },
          },
          metadata: {
            source: "AI_EXECUTION_RECOVERY",
            aiRequestId: request.id,
            modelSlug: request.model.slug,
            provider: request.provider,
          },
        });
        counters.recovered += 1;
      } catch (error: unknown) {
        counters.errors += 1;
        this.logger.error(
          {
            operation: "ai_artifact_recovery",
            aiRequestId: request.id,
            invocationId: invocation.id,
            result: "recovery_failed",
            error: error instanceof Error ? error.message : "unknown",
          },
          "AI artifact recovery failed",
        );
      }
    }

    return counters;
  }
}

function selectRecoveryRequest(execution: {
  aiRequest: {
    id: string;
    status: string;
    outputText: string | null;
    provider: string;
    model: { slug: string };
  };
  providerTurns: Array<{
    turnIndex: number;
    toolCallsJson: Prisma.JsonValue | null;
    toolCallError: boolean;
    aiRequest: {
      id: string;
      status: string;
      outputText: string | null;
      provider: string;
      model: { slug: string };
    };
  }>;
}): {
  id: string;
  outputText: string;
  provider: string;
  model: { slug: string };
} | null {
  if (execution.providerTurns.length > 0) {
    for (const turn of execution.providerTurns) {
      if (
        !turn.toolCallError &&
        turn.aiRequest.status === "SUCCEEDED" &&
        turn.aiRequest.outputText !== null &&
        hasNoToolCalls(turn.toolCallsJson)
      ) {
        return {
          ...turn.aiRequest,
          outputText: turn.aiRequest.outputText,
        };
      }
    }
    // Provider-turn persistence is authoritative once it exists. Never fall
    // back to the legacy primary pointer for a multi-turn execution because it
    // may point at an intermediate tool-request turn.
    return null;
  }

  if (
    execution.aiRequest.status === "SUCCEEDED" &&
    execution.aiRequest.outputText !== null
  ) {
    return {
      ...execution.aiRequest,
      outputText: execution.aiRequest.outputText,
    };
  }
  return null;
}

function hasNoToolCalls(value: Prisma.JsonValue | null): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function parseSingleTextOutput(
  value: Prisma.JsonValue,
): { name: string; type: ArtifactType } {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("AI invocation must declare exactly one output");
  }
  const item = value[0];
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error("AI output declaration is invalid");
  }
  const record = item as Record<string, Prisma.JsonValue>;
  if (typeof record.name !== "string" || typeof record.artifactType !== "string") {
    throw new Error("AI output declaration is invalid");
  }
  const type = record.artifactType as ArtifactType;
  if (!SUPPORTED_TEXT_TYPES.has(type)) {
    throw new Error("AI artifact recovery supports textual outputs only");
  }
  return { name: record.name, type };
}
