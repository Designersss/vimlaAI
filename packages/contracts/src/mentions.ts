import { z } from "zod";
import { handleSchema, normalizeHandleInput } from "./handles.js";

const MODEL_HANDLE_MAX_LENGTH = 128;
const MODEL_HANDLE_CHARACTERS = /^[a-z0-9._-]+$/;
const MODEL_HANDLE_BOUNDARY = /^[a-z0-9].*[a-z0-9]$/;
const MODEL_CONSECUTIVE_SEPARATORS = /[._-]{2}/;

const aiModelHandleSchema = z
  .string()
  .min(3)
  .max(MODEL_HANDLE_MAX_LENGTH)
  .regex(MODEL_HANDLE_CHARACTERS)
  .regex(MODEL_HANDLE_BOUNDARY)
  .refine((value) => !MODEL_CONSECUTIVE_SEPARATORS.test(value), {
    message: "Model handle cannot contain consecutive separators",
  });

export const mentionCandidateKindSchema = z.enum(["USER", "SYSTEM_AGENT", "AI_AUTO", "AI_MODEL"]);
export type MentionCandidateKind = z.infer<typeof mentionCandidateKindSchema>;

const mentionCandidatePresentationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  description: z.string().max(240).nullable().default(null),
  avatarUrl: z.string().url().nullable().default(null),
  role: z.string().max(80).nullable().default(null),
});

export const mentionCandidateSchema = z.discriminatedUnion("kind", [
  mentionCandidatePresentationSchema.extend({ kind: z.literal("USER"), handle: handleSchema }).strict(),
  mentionCandidatePresentationSchema.extend({ kind: z.literal("SYSTEM_AGENT"), handle: handleSchema }).strict(),
  mentionCandidatePresentationSchema.extend({ kind: z.literal("AI_AUTO"), handle: handleSchema }).strict(),
  mentionCandidatePresentationSchema.extend({ kind: z.literal("AI_MODEL"), handle: aiModelHandleSchema }).strict(),
]);
export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

const mentionQuerySchema = z
  .string()
  .max(MODEL_HANDLE_MAX_LENGTH + 1)
  .transform((value) => normalizeHandleInput(value));

export const mentionSuggestionsQuerySchema = z
  .object({
    q: mentionQuerySchema.optional().default(""),
    conversationId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    directConversationId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const contexts = [value.conversationId, value.projectId, value.directConversationId].filter(Boolean);
    if (contexts.length > 1) {
      context.addIssue({
        code: "custom",
        message: "Only one mention context can be supplied",
      });
    }
  });
export type MentionSuggestionsQuery = z.infer<typeof mentionSuggestionsQuerySchema>;

export const mentionSuggestionsResponseSchema = z
  .object({
    people: z.array(mentionCandidateSchema),
    vimla: z.array(mentionCandidateSchema),
    ai: z.array(mentionCandidateSchema),
  })
  .strict();
export type MentionSuggestionsResponse = z.infer<typeof mentionSuggestionsResponseSchema>;
