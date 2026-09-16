import { z } from "zod";
import type { DependencyCondition } from "./dependencies.js";
import type { InvocationTarget } from "./targets.js";
import { EXECUTION_PLAN_SCHEMA_VERSION } from "./types.js";
import type {
  AcceptanceCriteria,
  ApprovalPolicy,
  ArtifactType,
  ExecutionPlan,
  FailurePolicy,
  InputBinding,
  Invocation,
  InvocationDependency,
  JoinPolicy,
  OutputDeclaration,
  RiskClass,
} from "./types.js";

const nonEmptyString = z.string().trim().min(1);

export const artifactTypeSchema: z.ZodType<ArtifactType> = z.enum([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "IMAGE",
  "PLAN",
  "FILE",
  "PATCH",
]);

export const evaluationModeSchema = z.enum(["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"]);

export const riskClassSchema: z.ZodType<RiskClass> = z.enum([
  "READ_ONLY",
  "INTERNAL_WRITE",
  "EXTERNAL_SIDE_EFFECT",
  "DESTRUCTIVE",
  "FINANCIAL",
]);

export const approvalPolicySchema: z.ZodType<ApprovalPolicy> = z.enum([
  "AUTO",
  "USER_CONFIRMATION",
  "HUMAN_APPROVAL",
]);

export const failurePolicySchema: z.ZodType<FailurePolicy> = z.enum(["FAIL_PLAN", "CONTINUE"]);

export const joinPolicySchema: z.ZodType<JoinPolicy> = z.enum(["ALL_REQUIRED", "ANY_REQUIRED", "ALL_SETTLED"]);

export const invocationTargetSchema: z.ZodType<InvocationTarget> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("VIMLA") }),
  z.strictObject({ kind: z.literal("AI_AUTO") }),
  z.strictObject({ kind: z.literal("AI_MODEL"), modelSlug: nonEmptyString }),
  z.strictObject({ kind: z.literal("EVALUATOR") }),
  z.strictObject({ kind: z.literal("AGENT"), agentId: nonEmptyString }),
]);

export const dependencyConditionSchema: z.ZodType<DependencyCondition> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("DATA") }),
  z.strictObject({ kind: z.literal("ON_SUCCESS") }),
  z.strictObject({ kind: z.literal("ON_FAILURE") }),
  z.strictObject({ kind: z.literal("ALWAYS") }),
  z.strictObject({ kind: z.literal("OUTCOME"), outcome: nonEmptyString }),
]);

export const inputBindingSchema: z.ZodType<InputBinding> = z.strictObject({
  inputName: nonEmptyString,
  sourceOutputName: nonEmptyString,
  expectedArtifactType: artifactTypeSchema,
});

export const outputDeclarationSchema: z.ZodType<OutputDeclaration> = z.strictObject({
  name: nonEmptyString,
  artifactType: artifactTypeSchema,
  description: nonEmptyString.optional(),
});

export const acceptanceCriteriaSchema: z.ZodType<AcceptanceCriteria> = z.strictObject({
  id: nonEmptyString,
  description: nonEmptyString,
  mode: evaluationModeSchema,
});

export const invocationSchema: z.ZodType<Invocation> = z.strictObject({
  id: nonEmptyString,
  purpose: nonEmptyString,
  target: invocationTargetSchema,
  outputs: z.array(outputDeclarationSchema),
  acceptanceCriteria: z.array(acceptanceCriteriaSchema),
  riskClass: riskClassSchema,
  approvalPolicy: approvalPolicySchema,
  failurePolicy: failurePolicySchema,
  joinPolicy: joinPolicySchema,
});

export const invocationDependencySchema: z.ZodType<InvocationDependency> = z.strictObject({
  id: nonEmptyString,
  fromInvocationId: nonEmptyString,
  toInvocationId: nonEmptyString,
  condition: dependencyConditionSchema,
  inputBindings: z.array(inputBindingSchema),
});

/**
 * Structural schema only. Cross-node semantics (cycles, missing nodes,
 * artifact compatibility, reachability and graph limits) belong to PR-03's
 * deterministic graph validator, not to this parser.
 */
export const executionPlanSchema: z.ZodType<ExecutionPlan> = z.strictObject({
  schemaVersion: z.literal(EXECUTION_PLAN_SCHEMA_VERSION),
  goal: nonEmptyString,
  maxParallelism: z.number().int().positive(),
  invocations: z.array(invocationSchema).min(1),
  dependencies: z.array(invocationDependencySchema),
});

export function parseExecutionPlan(input: unknown): ExecutionPlan {
  return executionPlanSchema.parse(input);
}
