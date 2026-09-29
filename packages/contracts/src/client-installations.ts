import { z } from "zod";

export const CLIENT_INSTALLATION_LIMITS = {
  appVersionMax: 64,
  capabilitiesMax: 32,
  capabilityNameMax: 64,
  protocolVersionMax: 1_000_000,
} as const;

export const preferenceScopeSchema = z.enum([
  "ACCOUNT",
  "INSTALLATION",
  "SURFACE",
]);
export type PreferenceScope = z.infer<typeof preferenceScopeSchema>;

export const clientInstallationIdSchema = z.string().uuid();

export const clientInstallationKindSchema = z.enum([
  "WEB",
  "DESKTOP",
  "IOS",
  "ANDROID",
]);
export type ClientInstallationKind = z.infer<
  typeof clientInstallationKindSchema
>;

const capabilitySchema = z
  .string()
  .min(1)
  .max(CLIENT_INSTALLATION_LIMITS.capabilityNameMax)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const clientInstallationCapabilitiesSchema = z
  .array(capabilitySchema)
  .max(CLIENT_INSTALLATION_LIMITS.capabilitiesMax)
  .refine((values) => new Set(values).size === values.length, {
    message: "Capabilities must be unique",
  })
  .transform((values) => [...values].sort());

export const registerClientInstallationSchema = z
  .object({
    id: clientInstallationIdSchema,
    kind: clientInstallationKindSchema,
    appVersion: z
      .string()
      .min(1)
      .max(CLIENT_INSTALLATION_LIMITS.appVersionMax)
      .nullable()
      .optional()
      .default(null),
    protocolVersion: z
      .number()
      .int()
      .min(1)
      .max(CLIENT_INSTALLATION_LIMITS.protocolVersionMax),
    capabilities: clientInstallationCapabilitiesSchema.default([]),
  })
  .strict();
export type RegisterClientInstallation = z.infer<
  typeof registerClientInstallationSchema
>;

export const clientInstallationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean(),
  })
  .strict();
export type ClientInstallationPreferences = z.infer<
  typeof clientInstallationPreferencesSchema
>;

export const updateClientInstallationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.pushEnabled !== undefined, {
    message: "At least one installation preference is required",
  });
export type UpdateClientInstallationPreferences = z.infer<
  typeof updateClientInstallationPreferencesSchema
>;

export const clientInstallationViewSchema = z
  .object({
    id: clientInstallationIdSchema,
    kind: clientInstallationKindSchema,
    appVersion: z
      .string()
      .min(1)
      .max(CLIENT_INSTALLATION_LIMITS.appVersionMax)
      .nullable(),
    protocolVersion: z
      .number()
      .int()
      .min(1)
      .max(CLIENT_INSTALLATION_LIMITS.protocolVersionMax),
    capabilities: clientInstallationCapabilitiesSchema,
    createdAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    preferences: clientInstallationPreferencesSchema,
  })
  .strict();
export type ClientInstallationView = z.infer<
  typeof clientInstallationViewSchema
>;
