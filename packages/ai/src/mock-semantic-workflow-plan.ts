const SEMANTIC_WORKFLOW_PLANNER_MARKER = "VIMLA_SEMANTIC_WORKFLOW_PLANNER_V1";

type PlannerMentionConstraint = {
  occurrenceId: string;
  canonicalHandle: string;
  target: { kind: "VIMLA" | "AI_AUTO" | "AI_MODEL"; modelSlug?: string };
};

/**
 * Deterministic local/test adapter for the semantic planner boundary.
 *
 * Production Semantic Planner must use an included internal model endpoint
 * through an explicitly configured adapter. This helper intentionally does not
 * call a paid external model and must never be treated as production semantics.
 */
export function mockSemanticWorkflowPlannerResponse(prompt: string): string {
  if (!prompt.includes(SEMANTIC_WORKFLOW_PLANNER_MARKER)) {
    throw new Error("Semantic planner marker is missing");
  }

  const userText = extractSection(prompt, "USER_REQUEST:")?.trim() ?? "";
  const mentionsRaw = extractSection(
    prompt,
    "PLANNER_MENTIONS:",
    "PLANNING_CONTEXT:",
  );
  const mentions = parseMentions(mentionsRaw);

  if (mentions.length === 0) {
    return JSON.stringify({
      schemaVersion: 1,
      decision: "CLARIFY",
      confidence: 0.9,
      clarificationQuestion:
        "Which Vimla or AI executor should handle this workflow?",
      goal: null,
      invocations: [],
      dependencies: [],
    });
  }

  if (
    mentions.length > 1 &&
    mentions.some((mention) => mention.target.kind === "VIMLA")
  ) {
    return JSON.stringify({
      schemaVersion: 1,
      decision: "CLARIFY",
      confidence: 0.72,
      clarificationQuestion:
        "Please clarify which part each Vimla action should perform.",
      goal: null,
      invocations: [],
      dependencies: [],
    });
  }

  return JSON.stringify({
    schemaVersion: 1,
    decision: "PLAN",
    confidence: 0.95,
    clarificationQuestion: null,
    goal: userText || "Execute the requested workflow",
    invocations: mentions.map((mention, index) => ({
      id: `draft-${String(index + 1).padStart(2, "0")}`,
      purpose: userText || `Execute with @${mention.canonicalHandle}`,
      targetHint: {
        kind: "MENTION",
        occurrenceId: mention.occurrenceId,
        semanticRole: "EXECUTION",
      },
      outputs:
        mention.target.kind === "VIMLA"
          ? []
          : [
              {
                name: "result",
                artifactType: "TEXT",
                description: "Primary output of this invocation",
              },
            ],
      acceptanceCriteria: [],
      riskHint:
        mention.target.kind === "VIMLA" ? "INTERNAL_WRITE" : "READ_ONLY",
      failurePolicy: "FAIL_PLAN",
      joinPolicy: "ALL_REQUIRED",
    })),
    dependencies: [],
  });
}

function parseMentions(value: string | null): PlannerMentionConstraint[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const target = record.target;
      if (typeof target !== "object" || target === null) return [];
      const targetRecord = target as Record<string, unknown>;
      if (
        typeof record.occurrenceId !== "string" ||
        typeof record.canonicalHandle !== "string" ||
        (targetRecord.kind !== "VIMLA" &&
          targetRecord.kind !== "AI_AUTO" &&
          targetRecord.kind !== "AI_MODEL")
      ) {
        return [];
      }
      return [
        {
          occurrenceId: record.occurrenceId,
          canonicalHandle: record.canonicalHandle,
          target: {
            kind: targetRecord.kind,
            ...(typeof targetRecord.modelSlug === "string"
              ? { modelSlug: targetRecord.modelSlug }
              : {}),
          },
        },
      ];
    });
  } catch {
    return [];
  }
}

function extractSection(
  text: string,
  startToken: string,
  endToken?: string,
): string | null {
  const start = text.indexOf(startToken);
  if (start < 0) return null;
  const from = start + startToken.length;
  const end = endToken ? text.indexOf(endToken, from) : -1;
  return (end < 0 ? text.slice(from) : text.slice(from, end)).trim();
}
