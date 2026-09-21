import { mockSemanticWorkflowPlannerResponse } from "@vimla/ai";
import type { SemanticPlannerModel } from "@vimla/orchestration";
import type { ApiRuntimeConfig } from "../config/api-config.js";

export const SEMANTIC_PLANNER_MODEL = Symbol("SEMANTIC_PLANNER_MODEL");

/**
 * Preview adapter for the PR-11 planner boundary.
 *
 * The orchestration service depends only on SemanticPlannerModel. A future
 * included Vimla Core/OpenAI-compatible local model can replace this provider
 * without changing planning/persistence code. We deliberately do not reuse the
 * paid external-AI path as a hidden planner fallback.
 */
export function createSemanticPlannerModel(
  config: ApiRuntimeConfig,
): SemanticPlannerModel {
  if (config.appEnv !== "local" && config.appEnv !== "test") {
    return {
      complete: () =>
        Promise.reject(
          new Error("Included semantic planner model is not configured"),
        ),
    };
  }

  return {
    complete: ({ prompt }) =>
      Promise.resolve(mockSemanticWorkflowPlannerResponse(prompt)),
  };
}
