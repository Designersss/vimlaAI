import {
  mockSemanticWorkflowPlannerResponse,
  OpenAiCompatibleSemanticPlannerModel,
} from "@vimla/ai";
import type { SemanticPlannerModel } from "@vimla/orchestration";
import type { ApiRuntimeConfig } from "../config/api-config.js";

export const SEMANTIC_PLANNER_MODEL = Symbol("SEMANTIC_PLANNER_MODEL");

/**
 * Semantic planning uses an included/internal model boundary. It must never
 * silently reuse the paid external-AI execution path.
 */
export function createSemanticPlannerModel(
  config: ApiRuntimeConfig,
): SemanticPlannerModel {
  if (config.semanticPlannerProvider === "vimla-core") {
    if (!config.vimlaCoreBaseUrl || !config.vimlaCoreModel) {
      throw new Error(
        "Vimla Core semantic planner requires base URL and model",
      );
    }
    return new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: config.vimlaCoreBaseUrl,
      model: config.vimlaCoreModel,
      apiKey: config.vimlaCoreApiKey,
      timeoutMs: config.vimlaCoreTimeoutMs,
    });
  }

  if (config.appEnv === "local" || config.appEnv === "test") {
    return {
      complete: ({ prompt }) =>
        Promise.resolve(mockSemanticWorkflowPlannerResponse(prompt)),
    };
  }

  return {
    complete: () =>
      Promise.reject(
        new Error(
          "Included semantic planner is not configured for this environment",
        ),
      ),
  };
}
