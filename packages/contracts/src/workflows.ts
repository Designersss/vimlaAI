import { z } from "zod";

export const workflowArtifactTypeSchema = z.enum([
  "TEXT",
  "PROMPT",
  "DOCUMENT",
  "CODE",
  "IMAGE",
  "PLAN",
  "FILE",
  "PATCH",
]);

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

export const workflowInvocationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("VIMLA") }),
  z.object({ kind: z.literal("AI_AUTO") }),
  z.object({ kind: z.literal("AI_MODEL"), modelSlug: z.string().min(1) }),
  z.object({ kind: z.literal("EVALUATOR") }),
  z.object({ kind: z.literal("AGENT"), agentId: z.string().min(1) }),
]);

export const workflowOutputDeclarationSchema = z.object({
  name: z.string().min(1),
  artifactType: workflowArtifactTypeSchema,
  description: z.string().optional(),
});

export const workflowAcceptanceCriteriaSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  mode: z.enum(["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"]),
});

export const workflowArtifactSummarySchema = z.object({
  artifactId: z.string().min(1),
  artifactVersionId: z.string().min(1),
  outputName: z.string().min(1),
  type: workflowArtifactTypeSchema,
  classification: z.string().min(1),
  version: z.number().int().min(1),
  createdAt: z.string(),
});

export const workflowInvocationRunSchema = z.object({
  id: z.string().min(1),
  attempt: z.number().int().min(1),
  status: workflowInvocationRunStatusSchema,
  outcome: z.string().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const workflowInvocationSchema = z.object({
  id: z.string().min(1),
  purpose: z.string().min(1),
  target: workflowInvocationTargetSchema,
  outputs: z.array(workflowOutputDeclarationSchema),
  acceptanceCriteria: z.array(workflowAcceptanceCriteriaSchema),
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
  status: workflowInvocationStatusSchema,
  requiresApproval: z.boolean(),
  latestRun: workflowInvocationRunSchema.nullable(),
  artifacts: z.array(workflowArtifactSummarySchema),
});

export const workflowDependencyConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DATA") }),
  z.object({ kind: z.literal("ON_SUCCESS") }),
  z.object({ kind: z.literal("ON_FAILURE") }),
  z.object({ kind: z.literal("ALWAYS") }),
  z.object({ kind: z.literal("OUTCOME"), outcome: z.string().min(1) }),
]);

export const workflowDependencySchema = z.object({
  id: z.string().min(1),
  fromInvocationId: z.string().min(1),
  toInvocationId: z.string().min(1),
  condition: workflowDependencyConditionSchema,
  inputBindings: z.array(
    z.object({
      inputName: z.string().min(1),
      sourceOutputName: z.string().min(1),
      expectedArtifactType: workflowArtifactTypeSchema,
    }),
  ),
});

export const executionPlanViewSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  schemaVersion: z.literal(1),
  version: z.number().int().min(1),
  planHash: z.string().min(1),
  goal: z.string().min(1),
  status: workflowPlanStatusSchema,
  maxParallelism: z.number().int().min(1),
  invocations: z.array(workflowInvocationSchema),
  dependencies: z.array(workflowDependencySchema),
  startedAt: z.string().nullable(),
  frozenAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const executionPlanLookupViewSchema = z.object({
  plan: executionPlanViewSchema.nullable(),
});

export const executionPlanConversationViewSchema = z.object({
  plans: z.array(executionPlanViewSchema),
});

export type WorkflowArtifactType = z.infer<typeof workflowArtifactTypeSchema>;
export type WorkflowPlanStatus = z.infer<typeof workflowPlanStatusSchema>;
export type WorkflowInvocationStatus = z.infer<typeof workflowInvocationStatusSchema>;
export type WorkflowInvocationRunStatus = z.infer<typeof workflowInvocationRunStatusSchema>;
export type WorkflowInvocationTarget = z.infer<typeof workflowInvocationTargetSchema>;
export type WorkflowArtifactSummary = z.infer<typeof workflowArtifactSummarySchema>;
export type WorkflowInvocationRun = z.infer<typeof workflowInvocationRunSchema>;
export type WorkflowInvocation = z.infer<typeof workflowInvocationSchema>;
export type WorkflowDependency = z.infer<typeof workflowDependencySchema>;
export type ExecutionPlanView = z.infer<typeof executionPlanViewSchema>;
export type ExecutionPlanLookupView = z.infer<typeof executionPlanLookupViewSchema>;
export type ExecutionPlanConversationView = z.infer<typeof executionPlanConversationViewSchema>;
