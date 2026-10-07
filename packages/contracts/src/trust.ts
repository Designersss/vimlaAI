import { z } from "zod";
import { handleSchema } from "./handles.js";
import { publicProfileAvatarUrlSchema, publicProfileDisplayNameSchema } from "./public-profiles.js";

export const TRUST_LIMITS = {
  reportDetailsMax: 1_000,
  evidenceTextMax: 4_000,
  blockedUsersPageDefault: 50,
  blockedUsersPageMax: 100,
} as const;

export const abuseReportReasonSchema = z.enum([
  "HARASSMENT",
  "HATE",
  "THREATS",
  "SPAM",
  "IMPERSONATION",
  "SEXUAL_CONTENT",
  "SELF_HARM",
  "OTHER",
]);
export type AbuseReportReason = z.infer<typeof abuseReportReasonSchema>;

export const abuseReportStatusSchema = z.enum([
  "SUBMITTED",
  "REVIEWING",
  "RESOLVED",
  "DISMISSED",
]);
export type AbuseReportStatus = z.infer<typeof abuseReportStatusSchema>;

export const blockUserSchema = z
  .object({
    handle: handleSchema,
  })
  .strict();
export type BlockUser = z.infer<typeof blockUserSchema>;

export const blockedUserSchema = z
  .object({
    userId: z.string().min(1).max(128),
    handle: handleSchema,
    displayName: publicProfileDisplayNameSchema,
    avatarUrl: publicProfileAvatarUrlSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type BlockedUser = z.infer<typeof blockedUserSchema>;

const blockedUsersCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const blockedUsersQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TRUST_LIMITS.blockedUsersPageMax)
      .default(TRUST_LIMITS.blockedUsersPageDefault),
    cursor: blockedUsersCursorSchema.optional(),
  })
  .strict();
export type BlockedUsersQuery = z.infer<typeof blockedUsersQuerySchema>;

export const blockedUsersResponseSchema = z
  .object({
    items: z.array(blockedUserSchema).max(TRUST_LIMITS.blockedUsersPageMax),
    nextCursor: blockedUsersCursorSchema.nullable(),
  })
  .strict();
export type BlockedUsersResponse = z.infer<typeof blockedUsersResponseSchema>;

export const userBlockStateSchema = z
  .object({
    handle: handleSchema,
    blockedByMe: z.boolean(),
  })
  .strict();
export type UserBlockState = z.infer<typeof userBlockStateSchema>;

export const directMessageReportEvidenceSchema = z
  .object({
    kind: z.literal("DIRECT_MESSAGE"),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    disclosedText: z
      .string()
      .min(1)
      .max(TRUST_LIMITS.evidenceTextMax)
      .refine((value) => value.trim().length > 0, "Evidence cannot be blank")
      .refine((value) => !value.includes("\u0000"), "Evidence cannot contain NUL"),
  })
  .strict();
export type DirectMessageReportEvidence = z.infer<
  typeof directMessageReportEvidenceSchema
>;

export const createAbuseReportSchema = z
  .object({
    targetHandle: handleSchema,
    reason: abuseReportReasonSchema,
    details: z
      .string()
      .trim()
      .min(1)
      .max(TRUST_LIMITS.reportDetailsMax)
      .refine((value) => !value.includes("\u0000"), "Report details cannot contain NUL")
      .nullable()
      .optional(),
    evidence: directMessageReportEvidenceSchema.nullable().optional(),
  })
  .strict();
export type CreateAbuseReport = z.infer<typeof createAbuseReportSchema>;

export const abuseReportReceiptSchema = z
  .object({
    id: z.string().uuid(),
    status: abuseReportStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AbuseReportReceipt = z.infer<typeof abuseReportReceiptSchema>;

export const updateSurfacePreferenceSchema = z
  .object({
    muted: z.boolean(),
  })
  .strict();
export type UpdateSurfacePreference = z.infer<typeof updateSurfacePreferenceSchema>;

export const surfacePreferenceSchema = z
  .object({
    surfaceId: z.string().uuid(),
    muted: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type SurfacePreference = z.infer<typeof surfacePreferenceSchema>;
