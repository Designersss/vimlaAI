import {
  type SemanticPlannerAbortSignal,
  type SemanticPlannerModel,
  type SemanticWorkflowPlannerInput,
  type SemanticWorkflowPlannerResult,
} from "./semantic-planner-contract.js";
import { compileSemanticPlannerDraft } from "./semantic-planner-compile.js";
import { buildSemanticPlannerPrompt } from "./semantic-planner-prompt.js";
import { parseSemanticPlannerOutput } from "./semantic-planner-schema.js";

export * from "./semantic-planner-contract.js";
export { compileSemanticPlannerDraft, normalizeSemanticExecutionPlan } from "./semantic-planner-compile.js";
export { buildSemanticPlannerPrompt } from "./semantic-planner-prompt.js";
export { parseSemanticPlannerOutput } from "./semantic-planner-schema.js";

export class SemanticWorkflowPlanner {
  constructor(private readonly model: SemanticPlannerModel) {}

  async plan(
    input: SemanticWorkflowPlannerInput & {
      correlationId: string;
      signal?: SemanticPlannerAbortSignal;
    },
  ): Promise<SemanticWorkflowPlannerResult> {
    const prompt = buildSemanticPlannerPrompt(input);
    const raw = await this.model.complete({
      prompt,
      correlationId: input.correlationId,
      signal: input.signal,
    });
    return compileSemanticPlannerDraft(
      input,
      parseSemanticPlannerOutput(raw),
    );
  }
}
