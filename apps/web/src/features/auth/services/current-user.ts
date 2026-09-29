import type { CurrentUser } from "@vimla/contracts";
import { AuthRequiredError } from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

export { AuthRequiredError };

export async function fetchCurrentUser(
  fetchImpl: typeof fetch = fetch,
): Promise<CurrentUser> {
  return createWebClientApi(fetchImpl).account.fetchCurrentUser();
}

export async function updatePreferences(
  input: { locale?: CurrentUser["locale"]; timezone?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CurrentUser> {
  return createWebClientApi(fetchImpl).account.updatePreferences(input);
}
