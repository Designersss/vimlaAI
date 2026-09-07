import { healthResponseSchema, type HealthResponse } from "@vimla/contracts";
import { publicWebConfig } from "../config/public-env";

export async function fetchApiHealth(
  apiBaseUrl: string = publicWebConfig.apiBaseUrl,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResponse> {
  const response = await fetchImpl(`${apiBaseUrl}/health`, {
    cache: "no-store",
  });

  const payload: unknown = await response.json();
  return healthResponseSchema.parse(payload);
}
