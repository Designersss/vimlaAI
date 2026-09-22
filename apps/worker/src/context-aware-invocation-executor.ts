import {
  ContextAccessDeniedError,
  ContextBundleService,
  ContextError,
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
  ) {
    this.bundles = bundles ?? new ContextBundleService(prisma);
  }

  async execute(
    input: InvocationExecutionInput,
  ): Promise<InvocationExecutionResult> {
    const invocation = await this.prisma.invocation.findFirst({
      where: {
        id: input.invocationId,
        planId: input.planId,
      },
      select: {
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

    try {
      await this.bundles.resolveForInvocation({
        actorUserId: invocation.plan.userId,
        invocationId: input.invocationId,
      });
    } catch (error: unknown) {
      if (error instanceof ContextAccessDeniedError) {
        return terminal("CONTEXT_POLICY_DENIED");
      }
      if (error instanceof ContextError) {
        return terminal("CONTEXT_POLICY_INVALID");
      }
      throw error;
    }

    return this.fallback.execute(input);
  }
}

function terminal(errorCode: string): InvocationExecutionResult {
  return {
    status: "FAILED",
    errorCode,
    retryable: false,
  };
}
