import { z } from "zod";
import { handleInputSchema, handleSchema } from "./handles.js";

export const PUBLIC_PROFILE_LIMITS = {
  displayNameMax: 80,
  bioMax: 280,
  statusMax: 80,
  avatarUrlMax: 2_048,
  searchQueryMax: 64,
  searchPrefixMatchMin: 2,
  searchContainsMatchMin: 3,
  searchLimitDefault: 20,
  searchLimitMax: 30,
} as const;

function hasNoNul(value: string): boolean {
  return !value.includes("\0");
}

const boundedPublicText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(hasNoNul, {
      message: "Public profile text contains an invalid character",
    });

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PUBLIC_PROFILE_LIMITS.displayNameMax)
  .refine(hasNoNul, {
    message: "Public profile text contains an invalid character",
  });

const nullableTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(hasNoNul, {
      message: "Public profile text contains an invalid character",
    })
    .transform((value) => (value.length > 0 ? value : null))
    .nullable();

export const publicProfileSchema = z
  .object({
    userId: z.string().min(1),
    handle: handleSchema,
    displayName: displayNameSchema,
    avatarUrl: z.string().url().max(PUBLIC_PROFILE_LIMITS.avatarUrlMax).nullable(),
    bio: boundedPublicText(PUBLIC_PROFILE_LIMITS.bioMax).nullable(),
    status: boundedPublicText(PUBLIC_PROFILE_LIMITS.statusMax).nullable(),
  })
  .strict();
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/**
 * Avatar mutation deliberately does not accept arbitrary URLs. MEDIA-01 will own
 * reviewed upload/media references; until then this identity contract only
 * exposes an already-reviewed avatar URL when one exists.
 */
export const updatePublicProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: nullableTrimmedText(PUBLIC_PROFILE_LIMITS.bioMax).optional(),
    status: nullableTrimmedText(PUBLIC_PROFILE_LIMITS.statusMax).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one public profile field must be provided",
  });
export type UpdatePublicProfile = z.infer<typeof updatePublicProfileSchema>;

export const publicProfileHandleParamsSchema = z
  .object({
    handle: handleInputSchema,
  })
  .strict();
export type PublicProfileHandleParams = z.infer<
  typeof publicProfileHandleParamsSchema
>;

export const peopleSearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(PUBLIC_PROFILE_LIMITS.searchQueryMax)
      .refine((value) => value !== "@", {
        message: "Search query must contain identity text",
      })
      .refine(hasNoNul, {
        message: "Search query contains an invalid character",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PUBLIC_PROFILE_LIMITS.searchLimitMax)
      .default(PUBLIC_PROFILE_LIMITS.searchLimitDefault),
  })
  .strict();
export type PeopleSearchQuery = z.infer<typeof peopleSearchQuerySchema>;

export const peopleSearchResponseSchema = z
  .object({
    items: z.array(publicProfileSchema).max(PUBLIC_PROFILE_LIMITS.searchLimitMax),
  })
  .strict();
export type PeopleSearchResponse = z.infer<typeof peopleSearchResponseSchema>;
