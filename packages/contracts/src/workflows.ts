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

const workflowIsoDateTimeSchema = z.string().datetime({ offset: true });

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

export const inputBindingSchema = z
  .object({
    inputName: graphKeySchema,
    sourceOutputName: graphKeySchema,
    expectedArtifactType: artifactTypeSchema,
  })
  .strict();

export const outputDeclarationSchema = z
  .object({
    name: graphKeySchema,
    artifactType: artifactTypeSchema,
    description: boundedText(
      EXECUTION_PLAN_API_LIMITS.descriptionMax,
    ).optional(),
  })
  .strict();

export const acceptanceCriteriaSchema = z
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
    outputs: z
      .array(outputDeclarationSchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxOutputsPerInvocation),
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
    approvalPolicy: z.enum([
      "AUTO",
      "USER_CONFIRMATION",
      "HUMAN_APPROVAL",
    ]),
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
    maxParallelism: z
      .number()
      .int()
      .min(1)
      .max(EXECUTION_PLAN_API_LIMITS.maxParallelism),
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

export const workflowPlanStatusSchema = z.enum([
  "PLANNING",
  "PLANNED",
  "RUNNING",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

export const workflowInvocationStatusSchema = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_FOR_USAGE_CAPACITY",
  "BLOCKED_INSUFFICIENT_USAGE",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELED",
]);

export const workflowInvocationRunStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "WAITING_FOR_USAGE_CAPACITY",
  "BLOCKED_INSUFFICIENT_USAGE",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

export const workflowArtifactSummarySchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    outputName: graphKeySchema,
    type: artifactTypeSchema,
    classification: z.string().trim().min(1).max(128),
    version: z.number().int().min(1),
    createdAt: workflowIsoDateTimeSchema,
  })
  .strict();

export const workflowInvocationRunSchema = z
  .object({
    id: z.string().min(1),
    attempt: z.number().int().min(1),
    status: workflowInvocationRunStatusSchema,
    outcome: z.string().nullable(),
    errorCode: z.string().nullable(),
    startedAt: workflowIsoDateTimeSchema.nullable(),
    finishedAt: workflowIsoDateTimeSchema.nullable(),
  })
  .strict();

export const workflowInvocationSchema = invocationSchema.extend({
  status: workflowInvocationStatusSchema,
  requiresApproval: z.boolean(),
  latestRun: workflowInvocationRunSchema.nullable(),
  artifacts: z.array(workflowArtifactSummarySchema),
});

export const workflowDependencySchema = invocationDependencySchema;

export const executionPlanViewSchema = z
  .object({
    id: z.string().min(1),
    messageId: z.string().min(1),
    conversationId: z.string().min(1),
    schemaVersion: z.literal(1),
    version: z.number().int().min(1),
    planHash: z.string().min(1),
    goal: boundedText(EXECUTION_PLAN_API_LIMITS.goalMax),
    status: workflowPlanStatusSchema,
    maxParallelism: z
      .number()
      .int()
      .min(1)
      .max(EXECUTION_PLAN_API_LIMITS.maxParallelism),
    invocations: z
      .array(workflowInvocationSchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxInvocations),
    dependencies: z
      .array(workflowDependencySchema)
      .max(EXECUTION_PLAN_API_LIMITS.maxDependencies),
    startedAt: workflowIsoDateTimeSchema.nullable(),
    frozenAt: workflowIsoDateTimeSchema.nullable(),
    completedAt: workflowIsoDateTimeSchema.nullable(),
    createdAt: workflowIsoDateTimeSchema,
    updatedAt: workflowIsoDateTimeSchema,
  })
  .strict();

export const executionPlanLookupViewSchema = z
  .object({
    plan: executionPlanViewSchema.nullable(),
  })
  .strict();

export const executionPlanConversationViewSchema = z
  .object({
    plans: z.array(executionPlanViewSchema),
  })
  .strict();

export const workflowArtifactTypeSchema = artifactTypeSchema;
export const workflowInvocationTargetSchema = invocationTargetSchema;
export const workflowOutputDeclarationSchema = outputDeclarationSchema;
export const workflowAcceptanceCriteriaSchema = acceptanceCriteriaSchema;
export const workflowDependencyConditionSchema = dependencyConditionSchema;

export type ExecutionPlanDefinition = z.infer<
  typeof executionPlanDefinitionSchema
>;
export type InvocationDefinition = z.infer<typeof invocationSchema>;
export type InvocationDependencyDefinition = z.infer<
  typeof invocationDependencySchema
>;
export type DependencyConditionDefinition = z.infer<
  typeof dependencyConditionSchema
>;
export type CreateExecutionPlanRequest = z.infer<
  typeof createExecutionPlanRequestSchema
>;
export type ApproveExecutionPlanRequest = z.infer<
  typeof approveExecutionPlanRequestSchema
>;
export type WorkflowArtifactType = z.infer<typeof artifactTypeSchema>;
export type WorkflowPlanStatus = z.infer<typeof workflowPlanStatusSchema>;
export type WorkflowInvocationStatus = z.infer<
  typeof workflowInvocationStatusSchema
>;
export type WorkflowInvocationRunStatus = z.infer<
  typeof workflowInvocationRunStatusSchema
>;
export type WorkflowInvocationTarget = z.infer<typeof invocationTargetSchema>;
export type WorkflowArtifactSummary = z.infer<
  typeof workflowArtifactSummarySchema
>;
export type WorkflowInvocationRun = z.infer<
  typeof workflowInvocationRunSchema
>;
export type WorkflowInvocation = z.infer<typeof workflowInvocationSchema>;
export type WorkflowDependency = z.infer<typeof workflowDependencySchema>;
export type ExecutionPlanView = z.infer<typeof executionPlanViewSchema>;
export type ExecutionPlanLookupView = z.infer<
  typeof executionPlanLookupViewSchema
>;
export type ExecutionPlanConversationView = z.infer<
  typeof executionPlanConversationViewSchema
>;

export type InvocationStatus = WorkflowInvocationStatus;
export type ExecutionPlanStatus = WorkflowPlanStatus;
