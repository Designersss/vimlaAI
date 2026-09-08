import { publicAdminConfig } from "../config/public-env";

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${publicAdminConfig.apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}
