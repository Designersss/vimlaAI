import { z } from "zod";
import { OPERATOR_RUNTIME_LIMITS } from "./limits.js";
import { OperatorError } from "./errors.js";
import { plannerOutputSchema } from "./tools/schemas.js";
import { sanitizePublicText } from "./public-text.js";
import type { PlannerPlan } from "./types.js";

export function parsePlannerOutput(raw: string): PlannerPlan {
  const jsonText = extractJsonObject(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText) as unknown;
  } catch {
    throw new OperatorError("PLAN_INVALID", "Planner output was not valid JSON");
  }

  const parsed = plannerOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new OperatorError("PLAN_INVALID", "Planner output failed schema validation");
  }

  if (parsed.data.intent === "act" && parsed.data.commands.length === 0) {
    throw new OperatorError("PLAN_INVALID", "Act plan must include commands");
  }
  if (parsed.data.intent === "answer" && parsed.data.commands.length > 0) {
    throw new OperatorError("PLAN_INVALID", "Answer plan cannot include commands");
  }

  if (parsed.data.intent === "clarify" && !parsed.data.clarificationQuestion) {
    throw new OperatorError("PLAN_INVALID", "Clarification plan must include a question");
  }

  return {
    intent: parsed.data.intent,
    userMessage: sanitizePublicText(parsed.data.userMessage, OPERATOR_RUNTIME_LIMITS.publicMessageMax),
    clarificationQuestion: parsed.data.clarificationQuestion
      ? sanitizePublicText(parsed.data.clarificationQuestion, OPERATOR_RUNTIME_LIMITS.clarificationMax)
      : null,
    commands: parsed.data.commands.map((command) => ({
      tool: command.tool,
      args: command.args,
    })),
  };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    return candidate;
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return candidate.slice(start, end + 1);
  }
  throw new OperatorError("PLAN_INVALID", "Planner output did not contain JSON");
}

export const plannerJsonGuard = z.string().min(1);
