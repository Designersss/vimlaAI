import { z } from "zod";

export const embeddingEnvShape = {
  EMBEDDING_PROVIDER: z.enum(["disabled", "internal-http"]).default("disabled"),
  EMBEDDING_INTERNAL_CONFIRMED: z.enum(["false", "true"]).default("false"),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_MODEL_REVISION: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(2000).default(768),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(10000),
};
export const embeddingConfigSchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  model: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(100),
  dimensions: z.number().int().min(1).max(2000),
  timeoutMs: z.number().int().min(1000).max(30000),
  apiKey: z.string().optional(),
});
type Env = z.infer<z.ZodObject<typeof embeddingEnvShape>>;
export function resolveEmbeddingConfig(
  env: Env,
): z.infer<typeof embeddingConfigSchema> | undefined {
  if (env.EMBEDDING_PROVIDER === "disabled") return undefined;
  if (env.EMBEDDING_INTERNAL_CONFIRMED !== "true")
    throw new Error(
      "EMBEDDING_INTERNAL_CONFIRMED must confirm included self-hosted inference; paid providers are not supported",
    );
  return embeddingConfigSchema.parse({
    baseUrl: env.EMBEDDING_BASE_URL,
    model: env.EMBEDDING_MODEL,
    revision: env.EMBEDDING_MODEL_REVISION,
    dimensions: env.EMBEDDING_DIMENSIONS,
    timeoutMs: env.EMBEDDING_TIMEOUT_MS,
    apiKey: env.EMBEDDING_API_KEY,
  });
}
