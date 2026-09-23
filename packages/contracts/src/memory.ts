import { z } from "zod";

export const MEMORY_LIMITS = {
  contentMax: 4_000,
  slotKeyMax: 128,
  listMax: 100,
  cursorMax: 512,
} as const;

export const MEMORY_SCOPE_KINDS = [
  "PERSONAL",
  "PROJECT",
  "CONVERSATION",
  "THREAD",
] as const;
export const memoryScopeKindSchema = z.enum(MEMORY_SCOPE_KINDS);
export type MemoryScopeKind = z.infer<typeof memoryScopeKindSchema>;

export const MEMORY_TYPES = [
  "USER_FACT",
  "USER_PREFERENCE",
  "USER_GOAL",
  "USER_RELATIONSHIP",
  "PROJECT_FACT",
  "PROJECT_DECISION",
  "PROJECT_STATE",
  "CONVERSATION_STATE",
  "THREAD_STATE",
  "DECISION",
  "ENTITY_RELATION",
] as const;
export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const personalMemoryTypeSchema = z.enum([
  "USER_FACT",
  "USER_PREFERENCE",
  "USER_GOAL",
  "USER_RELATIONSHIP",
  "DECISION",
  "ENTITY_RELATION",
]);
export type PersonalMemoryType = z.infer<typeof personalMemoryTypeSchema>;

export const projectMemoryTypeSchema = z.enum([
  "PROJECT_FACT",
  "PROJECT_DECISION",
  "PROJECT_STATE",
  "DECISION",
  "ENTITY_RELATION",
]);
export type ProjectMemoryType = z.infer<
  typeof projectMemoryTypeSchema
>;

export const MEMORY_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "PRIVATE",
  "RESTRICTED",
] as const;
export const memoryClassificationSchema = z.enum(
  MEMORY_CLASSIFICATIONS,
);
export type MemoryClassification = z.infer<typeof memoryClassificationSchema>;

export const MEMORY_SENSITIVITIES = [
  "NORMAL",
  "SENSITIVE",
] as const;
export const memorySensitivitySchema = z.enum(
  MEMORY_SENSITIVITIES,
);
export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;

export const MEMORY_ORIGINS = [
  "AUTO_EXTRACTION",
  "USER_EXPLICIT",
  "USER_CORRECTION",
  "E2EE_USER_DISCLOSURE",
] as const;
export const memoryOriginSchema = z.enum(MEMORY_ORIGINS);
export type MemoryOrigin = z.infer<typeof memoryOriginSchema>;

export const MEMORY_STATES = [
  "ACTIVE",
  "SUPERSEDED",
  "INVALIDATED",
] as const;
export const memoryStateSchema = z.enum(MEMORY_STATES);
export type MemoryState = z.infer<typeof memoryStateSchema>;

const optionalDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .optional();

export const createPersonalMemorySchema = z
  .object({
    type: personalMemoryTypeSchema,
    slotKey: z.string().trim().min(1).max(MEMORY_LIMITS.slotKeyMax),
    content: z.string().trim().min(1).max(MEMORY_LIMITS.contentMax),
    expiresAt: optionalDateTimeSchema,
  })
  .strict();
export type CreatePersonalMemory = z.infer<
  typeof createPersonalMemorySchema
>;

export const createProjectMemorySchema = z
  .object({
    type: projectMemoryTypeSchema,
    slotKey: z.string().trim().min(1).max(MEMORY_LIMITS.slotKeyMax),
    content: z.string().trim().min(1).max(MEMORY_LIMITS.contentMax),
    expiresAt: optionalDateTimeSchema,
  })
  .strict();
export type CreateProjectMemory = z.infer<
  typeof createProjectMemorySchema
>;

export const correctPersonalMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(MEMORY_LIMITS.contentMax),
    expiresAt: z
      .union([
        z.string().datetime({ offset: true }),
        z.null(),
      ])
      .optional(),
  })
  .strict();
export type CorrectPersonalMemory = z.infer<
  typeof correctPersonalMemorySchema
>;

export const promoteE2eeMemorySchema = z
  .object({
    directConversationId: z.string().uuid(),
    sourceMessageId: z.string().uuid(),
    type: personalMemoryTypeSchema,
    slotKey: z.string().trim().min(1).max(MEMORY_LIMITS.slotKeyMax),
    content: z.string().trim().min(1).max(MEMORY_LIMITS.contentMax),
    expiresAt: optionalDateTimeSchema,
  })
  .strict();
export type PromoteE2eeMemory = z.infer<
  typeof promoteE2eeMemorySchema
>;

export const listMemoriesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MEMORY_LIMITS.listMax)
      .default(50),
    cursor: z
      .string()
      .min(1)
      .max(MEMORY_LIMITS.cursorMax)
      .optional(),
  })
  .strict();
export type ListMemoriesQuery = z.infer<
  typeof listMemoriesQuerySchema
>;

export const memoryViewSchema = z
  .object({
    id: z.string().uuid(),
    scopeKind: memoryScopeKindSchema,
    projectId: z.string().uuid().nullable(),
    conversationId: z.string().nullable(),
    threadId: z.string().nullable(),
    type: memoryTypeSchema,
    slotKey: z.string(),
    content: z.string(),
    classification: memoryClassificationSchema,
    sensitivity: memorySensitivitySchema,
    confidence: z.number().min(0).max(1),
    quality: z.number().min(0).max(1),
    origin: memoryOriginSchema,
    state: memoryStateSchema,
    validFrom: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    userConfirmedAt: z.string().datetime({ offset: true }).nullable(),
    userCorrectedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type MemoryView = z.infer<typeof memoryViewSchema>;

export const memoriesResponseSchema = z
  .object({
    items: z.array(memoryViewSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type MemoriesResponse = z.infer<
  typeof memoriesResponseSchema
>;


export const memoryExtractionCandidateSchema = z
  .object({
    type: z.enum([
      "USER_FACT",
      "USER_PREFERENCE",
      "USER_GOAL",
      "USER_RELATIONSHIP",
    ]),
    slotKey: z.string().trim().min(1).max(MEMORY_LIMITS.slotKeyMax),
    content: z.string().trim().min(1).max(MEMORY_LIMITS.contentMax),
    confidence: z.number().min(0).max(1),
    sensitivity: memorySensitivitySchema,
    transient: z.boolean().default(false),
  })
  .strict();
export type MemoryExtractionCandidate = z.infer<
  typeof memoryExtractionCandidateSchema
>;

export const memoryExtractionModelOutputSchema = z
  .object({
    candidates: z
      .array(memoryExtractionCandidateSchema)
      .max(8),
  })
  .strict();
export type MemoryExtractionModelOutput = z.infer<
  typeof memoryExtractionModelOutputSchema
>;

export const memoryCompactionModelOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(32_000),
  })
  .strict();
export type MemoryCompactionModelOutput = z.infer<
  typeof memoryCompactionModelOutputSchema
>;
