import { z } from "zod";

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

const HANDLE_CHARACTERS = /^[a-z0-9._]+$/;
const HANDLE_BOUNDARY = /^[a-z0-9].*[a-z0-9]$/;
const CONSECUTIVE_SEPARATORS = /[._]{2}/;

/**
 * Normalize user-entered handle text for lookup/validation.
 * The persisted canonical value never includes the leading @ and is lowercase.
 * Whitespace is deliberately not trimmed: whitespace is invalid input.
 */
export function normalizeHandleInput(value: string): string {
  const withoutPrefix = value.startsWith("@") ? value.slice(1) : value;
  return withoutPrefix.toLowerCase();
}

export const handleSchema = z
  .string()
  .min(HANDLE_MIN_LENGTH)
  .max(HANDLE_MAX_LENGTH)
  .regex(HANDLE_CHARACTERS)
  .regex(HANDLE_BOUNDARY)
  .refine((value) => !CONSECUTIVE_SEPARATORS.test(value), {
    message: "Handle cannot contain consecutive separators",
  });
export type Handle = z.infer<typeof handleSchema>;

export const handleInputSchema = z
  .string()
  .min(1)
  .max(HANDLE_MAX_LENGTH + 1)
  .transform(normalizeHandleInput)
  .pipe(handleSchema);

export const claimHandleSchema = z
  .object({
    handle: handleInputSchema,
  })
  .strict();
export type ClaimHandle = z.infer<typeof claimHandleSchema>;

export const handleAvailabilityResponseSchema = z.object({
  handle: handleSchema,
  available: z.boolean(),
});
export type HandleAvailabilityResponse = z.infer<typeof handleAvailabilityResponseSchema>;
