import {
  ContextAccessDeniedError,
  ContextBundleService,
  ContextError,
  type ContextBundleView,
} from "@vimla/context";
import type { PrismaClient } from "@vimla/database";
import type {
  InvocationExecutionInput,
  InvocationExecutionResult,
  InvocationExecutorRegistry,
} from "./orchestration.js";

export class ContextAwareInvocationExecutorRegistry
  implements InvocationExecutorRegistry
{
  private readonly bundles: ContextBundleService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fallback: InvocationExecutorRegistry,
    bundles?: ContextBundleService,
    private readonly enabled = true,
  ) {
    this.bundles = bundles ?? new ContextBundleService(prisma);
  }

  async execute(
    input: InvocationExecutionInput,
  ): Promise<InvocationExecutionResult> {
    if (!this.enabled) {
      return terminal("CONTEXT_RETRIEVAL_DISABLED");
    }

    const invocation = await this.prisma.invocation.findFirst({
      where: {
        id: input.invocationId,
        planId: input.planId,
      },
      select: {
        targetKind: true,
        targetModelSlug: true,
        targetAgentId: true,
        plan: {
          select: {
            userId: true,
          },
        },
      },
    });
    if (!invocation) {
      return terminal("CONTEXT_POLICY_INVOCATION_NOT_FOUND");
    }
    if (!persistedTargetMatches(invocation, input.target)) {
      return terminal("CONTEXT_POLICY_TARGET_MISMATCH");
    }

    let bundle: ContextBundleView;
    try {
      bundle = await this.bundles.resolveForInvocation({
        actorUserId: invocation.plan.userId,
        invocationId: input.invocationId,
      });
      if (
        input.target.kind === "VIMLA" &&
        bundle.manifest.surfaceKind !== "PERSONAL"
      ) {
        return terminal("CONTEXT_POLICY_EXECUTOR_SURFACE_UNSUPPORTED");
      }
    } catch (error: unknown) {
      if (error instanceof ContextAccessDeniedError) {
        return terminal("CONTEXT_POLICY_DENIED");
      }
      if (error instanceof ContextError) {
        return terminal("CONTEXT_POLICY_INVALID");
      }
      throw error;
    }

    return this.fallback.execute({
      ...input,
      contextBundle: bundle,
    });
  }
}

function persistedTargetMatches(
  invocation: {
    targetKind: string;
    targetModelSlug: string | null;
    targetAgentId: string | null;
  },
  target: InvocationExecutionInput["target"],
): boolean {
  return (
    invocation.targetKind === target.kind &&
    invocation.targetModelSlug === target.modelSlug &&
    invocation.targetAgentId === target.agentId
  );
}

function terminal(errorCode: string): InvocationExecutionResult {
  return {
    status: "FAILED",
    errorCode,
    retryable: false,
  };
}
