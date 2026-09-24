import { z } from "zod";
import { messageMentionInputSchema, messageMentionViewSchema } from "./mentions.js";
import { operatorRunViewSchema } from "./operator.js";

export const conversationDefaultTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("AI_AUTO") }).strict(),
  z
    .object({
      kind: z.literal("AI_MODEL"),
      modelId: z.string().min(1).max(128),
    })
    .strict(),
]);
export type ConversationDefaultTarget = z.infer<
  typeof conversationDefaultTargetSchema
>;

export const createConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().uuid().optional(),
    defaultTarget: conversationDefaultTargetSchema.optional(),
  })
  .strict();
export type CreateConversation = z.infer<typeof createConversationSchema>;

export const updateConversationDefaultTargetSchema =
  conversationDefaultTargetSchema;
export type UpdateConversationDefaultTarget = z.infer<
  typeof updateConversationDefaultTargetSchema
>;

export const chatMessageRouteSchema = z.enum(["CHAT", "ORCHESTRATION"]);
export type ChatMessageRoute = z.infer<typeof chatMessageRouteSchema>;

export const sendMessageSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    // Compatibility bridge for pre-PR-18 clients. Once a thread has a
    // persistent default target the server ignores this field.
    modelId: z.string().min(1).max(128).optional(),
    content: z.string().min(1),
    mentions: z.array(messageMentionInputSchema).max(32).default([]),
  })
  .strict();
export type SendMessage = z.input<typeof sendMessageSchema>;

export const retailAiModelSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  supportsStreaming: z.boolean(),
});
export type RetailAiModel = z.infer<typeof retailAiModelSchema>;

export const aiModelsResponseSchema = z.object({
  models: z.array(retailAiModelSchema),
});
export type AiModelsResponse = z.infer<typeof aiModelsResponseSchema>;

export const conversationSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  defaultTarget: conversationDefaultTargetSchema.nullable(),
  updatedAt: z.string(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});
export type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;

export const conversationCreatedSchema = conversationSummarySchema;
export type ConversationCreated = z.infer<typeof conversationCreatedSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["USER", "ASSISTANT"]),
  content: z.string(),
  status: z.enum(["COMPLETE", "STREAMING", "FAILED"]),
  createdAt: z.string(),
  operatorRun: operatorRunViewSchema.nullable().optional(),
  mentions: z.array(messageMentionViewSchema).default([]),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationDetailSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  defaultTarget: conversationDefaultTargetSchema.nullable(),
  updatedAt: z.string(),
  messages: z.array(chatMessageSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const operatorConversationSchema = z.object({
  id: z.string().nullable(),
  title: z.string().nullable(),
  messages: z.array(chatMessageSchema),
});
export type OperatorConversation = z.infer<typeof operatorConversationSchema>;
