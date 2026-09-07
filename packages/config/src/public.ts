import { publicWebConfigSchema, publicWebEnvSchema } from "./schemas.js";
import type { PublicWebConfig } from "./schemas.js";

/**
 * Validates the browser-safe public config.
 *
 * Next.js only inlines env vars that appear as static `process.env.NEXT_PUBLIC_*`
 * property access in application source. Call this from `apps/web` with those
 * explicit reads — do not pass a dynamic `process.env` object from a package.
 */
export function parsePublicWebConfig(
  env: Record<string, string | undefined>,
): PublicWebConfig {
  const parsed = publicWebEnvSchema.parse(env);
  return publicWebConfigSchema.parse({
    apiBaseUrl: stripTrailingSlash(parsed.NEXT_PUBLIC_API_BASE_URL),
  });
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
