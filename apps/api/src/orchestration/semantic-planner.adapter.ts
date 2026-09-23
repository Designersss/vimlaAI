import { OpenAiCompatibleSemanticPlannerModel } from "@vimla/ai";
import { mockSemanticWorkflowPlannerResponse } from "@vimla/ai/semantic-planner-testing";
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
  if (config.semanticPlannerProvider === "internal-http") {
    if (!config.semanticPlannerBaseUrl || !config.semanticPlannerModel) {
      throw new Error(
        "Internal semantic planner requires base URL and model",
      );
    }
    return new OpenAiCompatibleSemanticPlannerModel({
      baseUrl: config.semanticPlannerBaseUrl,
      model: config.semanticPlannerModel,
      apiKey: config.semanticPlannerApiKey,
      timeoutMs: config.semanticPlannerTimeoutMs,
    });
  }

  if (config.appEnv === "local" || config.appEnv === "test") {
    return {
      complete: ({ prompt }) => {
        if (prompt.startsWith("You extract durable personal memory")) {
          return Promise.resolve(JSON.stringify({ candidates: [] }));
        }
        if (
          prompt.startsWith(
            "Create the next loss-minimizing compacted conversation state",
          )
        ) {
          return Promise.resolve(
            JSON.stringify({
              summary: "Local/test compacted conversation state",
            }),
          );
        }
        return Promise.resolve(
          mockSemanticWorkflowPlannerResponse(prompt),
        );
      },
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
