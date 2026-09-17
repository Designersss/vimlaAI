import { z } from "zod";
import { HANDLE_MAX_LENGTH, handleSchema, normalizeHandleInput } from "./handles.js";

export const mentionCandidateKindSchema = z.enum(["USER", "SYSTEM_AGENT", "AI_AUTO", "AI_MODEL"]);
export type MentionCandidateKind = z.infer<typeof mentionCandidateKindSchema>;

export const mentionCandidateSchema = z
  .object({
    id: z.string().min(1),
    kind: mentionCandidateKindSchema,
    handle: handleSchema,
    label: z.string().min(1).max(120),
    description: z.string().max(240).nullable().default(null),
    avatarUrl: z.string().url().nullable().default(null),
    role: z.string().max(80).nullable().default(null),
  })
  .strict();
export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

const mentionQuerySchema = z
  .string()
  .max(HANDLE_MAX_LENGTH + 1)
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
