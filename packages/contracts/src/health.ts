import { z } from "zod";

export const healthCheckStatusSchema = z.enum(["ok", "error"]);
export type HealthCheckStatus = z.infer<typeof healthCheckStatusSchema>;

export const healthCheckSchema = z.object({
  status: healthCheckStatusSchema,
  detail: z.string().optional(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const healthStatusSchema = z.enum(["ok", "degraded", "error"]);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.literal("api"),
  checks: z.object({
    api: healthCheckSchema,
    database: healthCheckSchema,
    redis: healthCheckSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
