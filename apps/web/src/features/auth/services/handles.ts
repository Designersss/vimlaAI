import type { HandleAvailabilityResponse } from "@vimla/contracts";
import { HandleUnavailableError } from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

export { HandleUnavailableError };

export async function checkHandleAvailability(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HandleAvailabilityResponse> {
  return createWebClientApi(fetchImpl).account.checkHandleAvailability(input);
}

export async function claimHandle(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  return createWebClientApi(fetchImpl).account.claimHandle(input);
}
