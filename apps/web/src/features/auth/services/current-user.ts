import { currentUserSchema, type CurrentUser } from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export async function fetchCurrentUser(
  fetchImpl: typeof fetch = fetch,
): Promise<CurrentUser> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/me`, {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new Error("Unable to load the current user");
  }

  const payload: unknown = await response.json();
  return currentUserSchema.parse(payload);
}

export async function updatePreferences(
  input: { locale?: CurrentUser["locale"]; timezone?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CurrentUser> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/me/preferences`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to update preferences");
  }
  return currentUserSchema.parse(await response.json());
}
