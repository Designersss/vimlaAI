import {
  ArtifactBindingError,
  ArtifactError,
  ArtifactService,
  type ArtifactContent,
  type ReadArtifactVersionResult,
} from "@vimla/artifacts";
import {
  acceptanceCriteriaSchema,
  outputDeclarationSchema,
} from "@vimla/contracts";
import { Prisma, type PrismaClient } from "@vimla/database";
import type {
  AcceptanceCriteria,
  EvaluationCriterionResult,
  EvaluationMode,
  EvaluationResult,
} from "@vimla/orchestration";
import type {
  InvocationExecutionInput,
  InvocationExecutionResult,
  InvocationExecutorRegistry,
} from "./orchestration.js";

type EvaluatorInputArtifact = {
  inputName: string;
  value: Prisma.JsonValue;
};

export interface AiEvaluationModel {
  evaluate(input: {
    purpose: string;
    criteria: readonly AcceptanceCriteria[];
    artifacts: readonly EvaluatorInputArtifact[];
  }): Promise<EvaluationResult>;
}

/**
 * Local/test-only model port used by the preview orchestration runtime.
 * It never routes through the paid external-AI executor.
 */
export class LocalTestAiEvaluationModel implements AiEvaluationModel {
  async evaluate(input: {
    purpose: string;
    criteria: readonly AcceptanceCriteria[];
    artifacts: readonly EvaluatorInputArtifact[];
  }): Promise<EvaluationResult> {
    const criteriaResults = input.criteria.map(
      (criterion): EvaluationCriterionResult => ({
        criterionId: criterion.id,
        outcome: "PASS",
        confidence: 0.9,
        summary: "Local/test evaluator accepted the criterion.",
      }),
    );
    return {
      mode: "AI_EVALUATOR",
      outcome: "PASS",
      confidence: 0.9,
      criteriaResults,
      summary: "Local/test AI evaluator result.",
    };
  }
}

export class EvaluationAwareInvocationExecutorRegistry
  implements InvocationExecutorRegistry
{
  constructor(
    private readonly evaluator: EvaluatorInvocationExecutor,
    private readonly fallback: InvocationExecutorRegistry,
  ) {}

  execute(input: InvocationExecutionInput): Promise<InvocationExecutionResult> {
    return input.target.kind === "EVALUATOR"
      ? this.evaluator.execute(input)
      : this.fallback.execute(input);
  }
}

export class EvaluatorInvocationExecutor {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly aiModel: AiEvaluationModel,
  ) {
    this.artifacts = new ArtifactService(prisma);
  }

  async execute(
    input: InvocationExecutionInput,
  ): Promise<InvocationExecutionResult> {
    if (input.target.kind !== "EVALUATOR") {
      return terminal("EVALUATOR_TARGET_MISMATCH");
    }

    try {
      const existing = await this.prisma.evaluation.findUnique({
        where: { invocationRunId: input.runId },
      });
      if (existing) {
        const result = evaluationFromStored(existing);
        await this.ensureOutcomeArtifact(input.invocationId, result);
        return { status: "COMPLETED", outcome: result.outcome };
      }

      const invocation = await this.prisma.invocation.findFirst({
        where: { id: input.invocationId, planId: input.planId },
        select: {
          purpose: true,
          targetKind: true,
          outputDeclarations: true,
          acceptanceCriteria: true,
          approvalPolicy: true,
          plan: { select: { userId: true } },
        },
      });
      if (!invocation || invocation.targetKind !== "EVALUATOR") {
        return terminal("EVALUATOR_CONTRACT_INVALID");
      }

      const outputs = parseOutputs(invocation.outputDeclarations);
      if (outputs.length !== 1 || outputs[0]?.artifactType !== "JSON") {
        return terminal("EVALUATOR_CONTRACT_INVALID");
      }
      const criteria = parseCriteria(invocation.acceptanceCriteria);
      if (criteria.length === 0) {
        return terminal("EVALUATOR_CONTRACT_INVALID");
      }
      const mode = singleMode(criteria);
      if (!mode) {
        return terminal("EVALUATOR_CONTRACT_INVALID");
      }
      if (mode === "HUMAN_APPROVAL") {
        return terminal("HUMAN_EVALUATION_REQUIRES_API_DECISION");
      }

      const resolved = await this.resolveArtifacts(
        invocation.plan.userId,
        input.invocationId,
      );

      const result =
        mode === "DETERMINISTIC"
          ? evaluateDeterministically(criteria, resolved)
          : validateAiEvaluation(
              await this.aiModel.evaluate({
                purpose: invocation.purpose,
                criteria,
                artifacts: resolved.map((item) => ({
                  inputName: item.inputName,
                  value: inlineJsonValue(item.version.content),
                })),
              }),
              criteria,
            );

      await this.persistResult(input.runId, mode, result);
      await this.ensureOutcomeArtifact(input.invocationId, result);
      return { status: "COMPLETED", outcome: result.outcome };
    } catch (error: unknown) {
      if (
        error instanceof ArtifactError ||
        error instanceof ArtifactBindingError ||
        error instanceof EvaluatorContractError
      ) {
        return terminal(
          error instanceof EvaluatorContractError
            ? error.code
            : "EVALUATOR_ARTIFACT_CONTRACT_INVALID",
        );
      }
      return {
        status: "FAILED",
        errorCode: "EVALUATOR_EXECUTION_FAILED",
        retryable: true,
      };
    }
  }

  private async resolveArtifacts(
    userId: string,
    invocationId: string,
  ): Promise<
    Array<{
      inputName: string;
      version: ReadArtifactVersionResult;
    }>
  > {
    const bindings = await this.artifacts.resolveInputBindings({
      actorUserId: userId,
      targetInvocationId: invocationId,
    });
    const resolved = [];
    for (const binding of bindings) {
      const version = await this.artifacts.readVersion({
        actorUserId: userId,
        artifactVersionId: binding.reference.artifactVersionId,
      });
      resolved.push({ inputName: binding.inputName, version });
    }
    return resolved;
  }

  private async persistResult(
    runId: string,
    mode: EvaluationMode,
    result: EvaluationResult,
  ): Promise<void> {
    const data = {
      invocationRunId: runId,
      evaluatorKind: mode,
      outcome: result.outcome,
      confidence: result.confidence,
      criteriaResults: toJsonCriteriaResults(result.criteriaResults),
      summary: result.summary ?? null,
    };

    try {
      await this.prisma.evaluation.create({ data });
    } catch (error: unknown) {
      if (!isUniqueConstraint(error)) throw error;
      const replay = await this.prisma.evaluation.findUnique({
        where: { invocationRunId: runId },
      });
      if (!replay) throw error;
      const stored = evaluationFromStored(replay);
      if (JSON.stringify(stored) !== JSON.stringify(normalizeEvaluation(result))) {
        throw new EvaluatorContractError(
          "EVALUATOR_IDEMPOTENCY_CONFLICT",
          "Evaluation replay does not match persisted result",
        );
      }
    }
  }

  private async ensureOutcomeArtifact(
    invocationId: string,
    result: EvaluationResult,
  ): Promise<void> {
    const invocation = await this.prisma.invocation.findUnique({
      where: { id: invocationId },
      select: {
        outputDeclarations: true,
        plan: { select: { userId: true } },
      },
    });
    if (!invocation) {
      throw new EvaluatorContractError(
        "EVALUATOR_CONTRACT_INVALID",
        "Evaluator invocation was not found",
      );
    }
    const outputs = parseOutputs(invocation.outputDeclarations);
    const output = outputs[0];
    if (!output || outputs.length !== 1 || output.artifactType !== "JSON") {
      throw new EvaluatorContractError(
        "EVALUATOR_CONTRACT_INVALID",
        "Evaluator must declare exactly one JSON output",
      );
    }

    const normalized = normalizeEvaluation(result);
    await this.artifacts.createArtifact({
      actorUserId: invocation.plan.userId,
      creatorInvocationId: invocationId,
      outputName: output.name,
      type: "JSON",
      classification: "PRIVATE",
      content: {
        kind: "INLINE_JSON",
        value: normalized as unknown as Prisma.InputJsonValue,
      },
      metadata: {
        source: "EVALUATION",
        evaluatorKind: result.mode,
      },
    });
  }
}

function parseCriteria(value: Prisma.JsonValue): AcceptanceCriteria[] {
  if (!Array.isArray(value)) {
    throw new EvaluatorContractError(
      "EVALUATOR_CONTRACT_INVALID",
      "Acceptance criteria must be an array",
    );
  }
  return value.map((item) => acceptanceCriteriaSchema.parse(item));
}

function parseOutputs(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) {
    throw new EvaluatorContractError(
      "EVALUATOR_CONTRACT_INVALID",
      "Output declarations must be an array",
    );
  }
  return value.map((item) => outputDeclarationSchema.parse(item));
}

function singleMode(
  criteria: readonly AcceptanceCriteria[],
): EvaluationMode | null {
  const modes = new Set(criteria.map((criterion) => criterion.mode));
  return modes.size === 1 ? (criteria[0]?.mode ?? null) : null;
}

function evaluateDeterministically(
  criteria: readonly AcceptanceCriteria[],
  resolved: readonly {
    inputName: string;
    version: ReadArtifactVersionResult;
  }[],
): EvaluationResult {
  const byInput = new Map(resolved.map((item) => [item.inputName, item.version]));
  const criteriaResults = criteria.map(
    (criterion): EvaluationCriterionResult => {
      if (!criterion.binding) {
        throw new EvaluatorContractError(
          "EVALUATOR_CONTRACT_INVALID",
          `Deterministic criterion ${criterion.id} has no binding`,
        );
      }
      const version = byInput.get(criterion.binding.inputName);
      if (!version) {
        throw new EvaluatorContractError(
          "EVALUATOR_INPUT_MISSING",
          `Missing evaluator input ${criterion.binding.inputName}`,
        );
      }

      let passed: boolean;
      switch (criterion.binding.kind) {
        case "ARTIFACT_EXISTS":
          passed = true;
          break;
        case "TEXT_CONTAINS": {
          const actual = artifactText(version.content);
          const expected = criterion.binding.value;
          passed = criterion.binding.caseSensitive
            ? actual.includes(expected)
            : actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
          break;
        }
        case "JSON_EQUALS": {
          const actual = jsonPointer(
            inlineJsonValue(version.content),
            criterion.binding.path,
          );
          passed = primitiveEquals(actual, criterion.binding.expectedValue);
          break;
        }
      }
      return {
        criterionId: criterion.id,
        outcome: passed ? "PASS" : "FAIL",
        confidence: 1,
        summary: passed
          ? "Deterministic criterion passed."
          : "Deterministic criterion failed.",
      };
    },
  );

  const outcome = criteriaResults.every((item) => item.outcome === "PASS")
    ? "PASS"
    : "FAIL";
  return {
    mode: "DETERMINISTIC",
    outcome,
    confidence: 1,
    criteriaResults,
    summary:
      outcome === "PASS"
        ? "All deterministic acceptance criteria passed."
        : "One or more deterministic acceptance criteria failed.",
  };
}

function validateAiEvaluation(
  result: EvaluationResult,
  criteria: readonly AcceptanceCriteria[],
): EvaluationResult {
  if (
    result.mode !== "AI_EVALUATOR" ||
    (result.outcome !== "PASS" && result.outcome !== "FAIL") ||
    !validConfidence(result.confidence)
  ) {
    throw new EvaluatorContractError(
      "AI_EVALUATOR_RESULT_INVALID",
      "AI evaluator returned an invalid result envelope",
    );
  }
  const expectedIds = new Set(criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  for (const item of result.criteriaResults) {
    if (
      !expectedIds.has(item.criterionId) ||
      seen.has(item.criterionId) ||
      (item.outcome !== "PASS" && item.outcome !== "FAIL") ||
      !validConfidence(item.confidence)
    ) {
      throw new EvaluatorContractError(
        "AI_EVALUATOR_RESULT_INVALID",
        "AI evaluator returned invalid criterion results",
      );
    }
    seen.add(item.criterionId);
  }
  if (seen.size !== expectedIds.size) {
    throw new EvaluatorContractError(
      "AI_EVALUATOR_RESULT_INVALID",
      "AI evaluator omitted acceptance criteria",
    );
  }
  const derivedOutcome = result.criteriaResults.every(
    (item) => item.outcome === "PASS",
  )
    ? "PASS"
    : "FAIL";
  if (result.outcome !== derivedOutcome) {
    throw new EvaluatorContractError(
      "AI_EVALUATOR_RESULT_INVALID",
      "AI evaluator outcome disagrees with criterion results",
    );
  }
  return normalizeEvaluation(result);
}

function inlineJsonValue(content: ArtifactContent): Prisma.JsonValue {
  if (content.kind !== "INLINE_JSON") {
    throw new EvaluatorContractError(
      "EVALUATOR_CONTENT_UNAVAILABLE",
      "Evaluator input is not available as inline content",
    );
  }
  return content.value as Prisma.JsonValue;
}

function artifactText(content: ArtifactContent): string {
  const value = inlineJsonValue(content);
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.text === "string"
  ) {
    return value.text;
  }
  return JSON.stringify(value);
}

function jsonPointer(value: Prisma.JsonValue, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) {
    throw new EvaluatorContractError(
      "EVALUATOR_CONTRACT_INVALID",
      "JSON_EQUALS path must be an RFC 6901 JSON pointer",
    );
  }
  let current: unknown = value;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      current = current[Number(token)];
      continue;
    }
    if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return undefined;
  }
  return current;
}

function primitiveEquals(
  actual: unknown,
  expected: string | number | boolean | null,
): boolean {
  return (
    (actual === null ||
      typeof actual === "string" ||
      typeof actual === "number" ||
      typeof actual === "boolean") &&
    Object.is(actual, expected)
  );
}

function validConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeEvaluation(result: EvaluationResult) {
  return {
    mode: result.mode,
    outcome: result.outcome,
    confidence: result.confidence,
    criteriaResults: result.criteriaResults.map((item) => ({
      criterionId: item.criterionId,
      outcome: item.outcome,
      confidence: item.confidence,
      summary: item.summary ?? null,
    })),
    summary: result.summary ?? null,
  };
}

function toJsonCriteriaResults(
  results: readonly EvaluationCriterionResult[],
): Prisma.InputJsonValue {
  return results.map((item) => ({
    criterionId: item.criterionId,
    outcome: item.outcome,
    confidence: item.confidence,
    summary: item.summary ?? null,
  })) as Prisma.InputJsonValue;
}

function evaluationFromStored(input: {
  evaluatorKind: string;
  outcome: string;
  confidence: number;
  criteriaResults: Prisma.JsonValue;
  summary: string | null;
}): EvaluationResult {
  if (
    !["DETERMINISTIC", "AI_EVALUATOR", "HUMAN_APPROVAL"].includes(
      input.evaluatorKind,
    ) ||
    (input.outcome !== "PASS" && input.outcome !== "FAIL") ||
    !validConfidence(input.confidence) ||
    !Array.isArray(input.criteriaResults)
  ) {
    throw new EvaluatorContractError(
      "EVALUATOR_PERSISTED_RESULT_INVALID",
      "Persisted evaluation result is invalid",
    );
  }

  const criteriaResults = input.criteriaResults.map((raw) => {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      typeof raw.criterionId !== "string" ||
      (raw.outcome !== "PASS" && raw.outcome !== "FAIL") ||
      typeof raw.confidence !== "number" ||
      !validConfidence(raw.confidence) ||
      (raw.summary !== null && typeof raw.summary !== "string")
    ) {
      throw new EvaluatorContractError(
        "EVALUATOR_PERSISTED_RESULT_INVALID",
        "Persisted evaluation criterion result is invalid",
      );
    }
    return {
      criterionId: raw.criterionId,
      outcome: raw.outcome,
      confidence: raw.confidence,
      ...(raw.summary === null ? {} : { summary: raw.summary }),
    } satisfies EvaluationCriterionResult;
  });

  return {
    mode: input.evaluatorKind as EvaluationMode,
    outcome: input.outcome,
    confidence: input.confidence,
    criteriaResults,
    ...(input.summary === null ? {} : { summary: input.summary }),
  };
}

function terminal(errorCode: string): InvocationExecutionResult {
  return { status: "FAILED", errorCode, retryable: false };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

class EvaluatorContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EvaluatorContractError";
  }
}
