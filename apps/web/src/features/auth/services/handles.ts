import {
  claimHandleSchema,
  handleAvailabilityResponseSchema,
  handleInputSchema,
  type HandleAvailabilityResponse,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";

export class HandleUnavailableError extends Error {
  constructor() {
    super("Handle is unavailable");
    this.name = "HandleUnavailableError";
  }
}

export async function checkHandleAvailability(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HandleAvailabilityResponse> {
  const handle = handleInputSchema.parse(input);
  const response = await fetchImpl(
    `${publicWebConfig.apiBaseUrl}/v1/handles/availability?handle=${encodeURIComponent(handle)}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("Unable to check handle availability");
  }
  return handleAvailabilityResponseSchema.parse(await response.json());
}

export async function claimHandle(input: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const body = claimHandleSchema.parse({ handle: input });
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/handles/claim`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 409) {
    throw new HandleUnavailableError();
  }
  if (!response.ok) {
    throw new Error("Unable to claim handle");
  }
}
