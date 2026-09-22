import { BadRequestException } from "@nestjs/common";
import {
  GraphValidationError,
  decideInvocationReadiness,
  validateExecutionPlanGraph,
  type DependencySourceRuntimeState,
} from "@vimla/orchestration";
import type {
  ExecutionPlanDefinition,
  InvocationDependencyDefinition,
  InvocationStatus,
} from "./contracts.js";

export function validateManualExecutionPlan(plan: ExecutionPlanDefinition): void {
  try {
    validateExecutionPlanGraph(plan);
  } catch (error: unknown) {
    if (error instanceof GraphValidationError) {
      invalid(error.message);
    }
    throw error;
  }

  for (const invocation of plan.invocations) {
    if (
      invocation.approvalPolicy === "AUTO" &&
      (invocation.riskClass === "EXTERNAL_SIDE_EFFECT" ||
        invocation.riskClass === "DESTRUCTIVE" ||
        invocation.riskClass === "FINANCIAL")
    ) {
      invalid(
        `Invocation ${invocation.id} requires explicit approval for risk class ${invocation.riskClass}`,
      );
    }

    if (invocation.target.kind === "EVALUATOR") {
      const mode = invocation.acceptanceCriteria[0]?.mode;
      if (invocation.riskClass !== "READ_ONLY") {
        invalid(
          `Evaluator ${invocation.id} must use READ_ONLY risk class`,
        );
      }
      if (
        mode === "HUMAN_APPROVAL" &&
        invocation.approvalPolicy !== "HUMAN_APPROVAL"
      ) {
        invalid(
          `Human evaluator ${invocation.id} requires HUMAN_APPROVAL policy`,
        );
      }
      if (
        mode !== "HUMAN_APPROVAL" &&
        invocation.approvalPolicy !== "AUTO"
      ) {
        invalid(
          `Automatic evaluator ${invocation.id} must use AUTO approval policy`,
        );
      }
    }
  }
}

export function initialInvocationStatuses(
  plan: ExecutionPlanDefinition,
): Map<string, InvocationStatus> {
  const incoming = new Map<string, InvocationDependencyDefinition[]>();
  for (const invocation of plan.invocations) {
    incoming.set(invocation.id, []);
  }
  for (const dependency of plan.dependencies) {
    incoming.get(dependency.toInvocationId)?.push(dependency);
  }

  const states = new Map<string, DependencySourceRuntimeState>(
    plan.invocations.map((invocation) => [
      invocation.id,
      { invocationId: invocation.id, status: "PENDING" },
    ]),
  );
  const result = new Map<string, InvocationStatus>();

  for (const invocation of plan.invocations) {
    const readiness = decideInvocationReadiness(
      invocation,
      incoming.get(invocation.id) ?? [],
      states,
    );
    if (readiness.decision === "READY") {
      result.set(
        invocation.id,
        invocation.approvalPolicy === "AUTO" ? "READY" : "WAITING_APPROVAL",
      );
    } else {
      result.set(invocation.id, readiness.decision);
    }
  }
  return result;
}

function invalid(message: string): never {
  throw new BadRequestException({ code: "validation_error", message });
}
