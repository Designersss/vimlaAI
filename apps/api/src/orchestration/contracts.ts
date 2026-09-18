import { z } from "zod";

export const EXECUTION_PLAN_API_LIMITS = {
  idMax: 96,
  goalMax: 4_000,
  purposeMax: 1_000,
  descriptionMax: 2_000,
  maxInvocations: 64,
  maxDependencies: 256,
  maxParallelism: 16,
  maxOutputsPerInvocation: 32,
  maxCriteriaPerInvocation: 32,
  maxBindingsPerDependency: 32,
} as const;

const graphKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(EXECUTION_PLAN_API_LIMITS.idMax)
  .regex(/^[A-Za-z0-9._:-]+$/);

const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const artifactTypeSchema = z.enum([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "IMAGE",
  "PLAN",
  "FILE",
  "PATCH",
]);

export const invocationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("VIMLA") }).strict(),
  z.object({ kind: z.literal("AI_AUTO") }).strict(),
  z
    .object({
      kind: z.literal("AI_MODEL"),
      modelSlug: boundedText(128),
    })
    .strict(),
  z.object({ kind: z.literal("EVALUATOR") }).strict(),
  z
    .object({
      kind: z.literal("AGENT"),
      agentId: boundedText(128),
    })
    .strict(),
]);

export const dependencyConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DATA") }).strict(),
  z.object({ kind: z.literal("ON_SUCCESS") }).strict(),
  z.object({ kind: z.literal("ON_FAILURE") }).strict(),
  z.object({ kind: z.literal("ALWAYS") }).strict(),
  z
    .object({
      kind: z.literal("OUTCOME"),
      outcome: boundedText(128),
    })
    .strict(),
]);

const inputBindingSchema = z
  .object({
    inputName: graphKeySchema,
    sourceOutputName: graphKeySchema,
    expectedArtifactType: artifactTypeSchema,
  })
  .strict();

const outputDeclarationSchema = z
  .object({
    name: graphKeySchema,
    artifactType: artifactTypeSchema,
    description: boundedText(EXECUTION_PLAN_API_LIMITS.descriptionMax).optional(),
  })
  .strict();

const acceptanceCriteriaSchema = z
  .object({
    id: graphKeySchema,
    description: boundedText(EXECUTION_PLAN_API_LIMITS.descriptionMax),
    mode: z.enum(["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"]),
  })
  .strict();

export const invocationSchema = z
  .object({
    id: graphKeySchema,
    purpose: boundedText(EXECUTION_PLAN_API_LIMITS.purposeMax),
    target: invocationTargetSchema,
    outputs: z.array(outputDeclarationSchema).max(EXECUTION_PLAN_API_LIMITS.maxOutputsPerInvocation),
    acceptanceCriteria: z
      .array(acceptanceCriteriaSchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxCriteriaPerInvocation),
    riskClass: z.enum([
      "READ_ONLY",
      "INTERNAL_WRITE",
      "EXTERNAL_SIDE_EFFECT",
      "DESTRUCTIVE",
      "FINANCIAL",
    ]),
    approvalPolicy: z.enum(["AUTO", "USER_CONFIRMATION", "HUMAN_APPROVAL"]),
    failurePolicy: z.enum(["FAIL_PLAN", "CONTINUE"]),
    joinPolicy: z.enum(["ALL_REQUIRED", "ANY_REQUIRED", "ALL_SETTLED"]),
  })
  .strict();

export const invocationDependencySchema = z
  .object({
    id: graphKeySchema,
    fromInvocationId: graphKeySchema,
    toInvocationId: graphKeySchema,
    condition: dependencyConditionSchema,
    inputBindings: z
      .array(inputBindingSchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxBindingsPerDependency),
  })
  .strict();

export const executionPlanDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    goal: boundedText(EXECUTION_PLAN_API_LIMITS.goalMax),
    maxParallelism: z.number().int().min(1).max(EXECUTION_PLAN_API_LIMITS.maxParallelism),
    invocations: z
      .array(invocationSchema)
      .min(1)
      .max(EXECUTION_PLAN_API_LIMITS.maxInvocations),
    dependencies: z
      .array(invocationDependencySchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxDependencies),
  })
  .strict();

export const createExecutionPlanRequestSchema = z
  .object({
    messageId: z.string().trim().min(1).max(64),
    plan: executionPlanDefinitionSchema,
  })
  .strict();

export const approveExecutionPlanRequestSchema = z
  .object({
    invocationId: graphKeySchema,
  })
  .strict();

export type ExecutionPlanDefinition = z.infer<typeof executionPlanDefinitionSchema>;
export type InvocationDefinition = z.infer<typeof invocationSchema>;
export type InvocationDependencyDefinition = z.infer<typeof invocationDependencySchema>;
export type DependencyConditionDefinition = z.infer<typeof dependencyConditionSchema>;
export type CreateExecutionPlanRequest = z.infer<typeof createExecutionPlanRequestSchema>;
export type ApproveExecutionPlanRequest = z.infer<typeof approveExecutionPlanRequestSchema>;

export type InvocationStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_FOR_USAGE_CAPACITY"
  | "BLOCKED_INSUFFICIENT_USAGE"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELED";

export type ExecutionPlanStatus =
  | "PLANNING"
  | "PLANNED"
  | "RUNNING"
  | "PARTIAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export interface ExecutionPlanInvocationView extends InvocationDefinition {
  status: InvocationStatus;
}

export interface ExecutionPlanView {
  id: string;
  messageId: string;
  conversationId: string;
  schemaVersion: 1;
  version: number;
  planHash: string;
  goal: string;
  status: ExecutionPlanStatus;
  maxParallelism: number;
  invocations: ExecutionPlanInvocationView[];
  dependencies: InvocationDependencyDefinition[];
  startedAt: string | null;
  frozenAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
