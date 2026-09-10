import { z } from "zod";

export const OPERATOR_LIMITS = {
  contentMin: 1,
  contentMax: 8_000,
  maxToolsPerRun: 8,
  publicMessageMax: 2_000,
  clarificationMax: 500,
} as const;

export const operatorRunStatusSchema = z.enum([
  "CREATED",
  "PLANNING",
  "AWAITING_CLARIFICATION",
  "AWAITING_CONFIRMATION",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "PARTIAL",
]);
export type OperatorRunStatus = z.infer<typeof operatorRunStatusSchema>;

export const operatorActionKindSchema = z.enum([
  "task",
  "reminder",
  "note",
  "list",
  "today",
  "profile",
  "notifications",
]);
export type OperatorActionKind = z.infer<typeof operatorActionKindSchema>;

export const operatorActionOperationSchema = z.enum([
  "listed",
  "read",
  "created",
  "updated",
  "deleted",
  "pinned",
  "item_added",
]);
export type OperatorActionOperation = z.infer<typeof operatorActionOperationSchema>;

export const operatorActionStatusSchema = z.enum([
  "success",
  "error",
  "pending_confirmation",
  "skipped",
]);
export type OperatorActionStatus = z.infer<typeof operatorActionStatusSchema>;

export const operatorActionCardSchema = z.object({
  kind: operatorActionKindSchema,
  operation: operatorActionOperationSchema,
  title: z.string().min(1).max(200),
  detail: z.string().max(400).nullable(),
  status: operatorActionStatusSchema,
  hrefPath: z.string().max(300).nullable(),
});
export type OperatorActionCard = z.infer<typeof operatorActionCardSchema>;

export const operatorRunViewSchema = z.object({
  id: z.string().uuid(),
  status: operatorRunStatusSchema,
  publicMessage: z.string().nullable(),
  clarificationQuestion: z.string().nullable(),
  confirmationRequired: z.boolean(),
  confirmationToken: z.string().nullable(),
  errorCode: z.string().nullable(),
  actions: z.array(operatorActionCardSchema),
  conversationId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OperatorRunView = z.infer<typeof operatorRunViewSchema>;

const forbiddenOperatorAuthorityFields = {
  userId: true,
  ownerId: true,
  ownerUserId: true,
  personalOwnerUserId: true,
  createdByUserId: true,
  scopeType: true,
  role: true,
  permissions: true,
  modelId: true,
  providerModelId: true,
  systemPrompt: true,
  price: true,
} as const;

export const createOperatorRunSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    content: z.string().trim().min(OPERATOR_LIMITS.contentMin).max(OPERATOR_LIMITS.contentMax),
    conversationId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type CreateOperatorRun = z.infer<typeof createOperatorRunSchema>;

export const confirmOperatorRunSchema = z
  .object({
    confirmationToken: z.string().min(16).max(128),
  })
  .strict();
export type ConfirmOperatorRun = z.infer<typeof confirmOperatorRunSchema>;

export const continueOperatorRunSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    content: z.string().trim().min(OPERATOR_LIMITS.contentMin).max(OPERATOR_LIMITS.contentMax),
  })
  .strict();
export type ContinueOperatorRun = z.infer<typeof continueOperatorRunSchema>;

export const forbiddenOperatorAuthorityKeys = Object.keys(forbiddenOperatorAuthorityFields);
