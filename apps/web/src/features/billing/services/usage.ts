import { usageResponseSchema, type UsageResponse } from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export async function fetchUsage(
  fetchImpl: typeof fetch = fetch,
): Promise<UsageResponse> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/usage`, {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new Error("Unable to load usage");
  }

  return usageResponseSchema.parse(await response.json());
}
