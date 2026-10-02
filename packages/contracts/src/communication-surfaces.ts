import { z } from "zod";

export const communicationSurfaceIdSchema =
  z.string().uuid();

export const communicationSurfaceKindSchema = z.enum([
  "AI_THREAD",
  "DIRECT",
]);
export type CommunicationSurfaceKind = z.infer<
  typeof communicationSurfaceKindSchema
>;

export const communicationSurfaceStatusSchema = z.enum([
  "ACTIVE",
]);
export type CommunicationSurfaceStatus = z.infer<
  typeof communicationSurfaceStatusSchema
>;

export const communicationSurfaceRefSchema = z
  .object({
    surfaceId: communicationSurfaceIdSchema,
    surfaceKind: communicationSurfaceKindSchema,
  })
  .strict();
export type CommunicationSurfaceRef = z.infer<
  typeof communicationSurfaceRefSchema
>;
