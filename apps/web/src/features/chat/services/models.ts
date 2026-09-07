import { aiModelsResponseSchema, type RetailAiModel } from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export async function fetchAiModels(
  fetchImpl: typeof fetch = fetch,
): Promise<RetailAiModel[]> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/ai/models`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to load models");
  }
  return aiModelsResponseSchema.parse(await response.json()).models;
}
