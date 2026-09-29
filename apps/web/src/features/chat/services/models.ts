import type { RetailAiModel } from "@vimla/contracts";
import { createWebClientApi } from "../../../shared/api/client";

export async function fetchAiModels(
  fetchImpl: typeof fetch = fetch,
): Promise<RetailAiModel[]> {
  return createWebClientApi(fetchImpl).chat.fetchAiModels();
}
