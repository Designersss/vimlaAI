import type { ContextBudget } from "./budget.js";
import { shouldUseCompactedState } from "./budget.js";
import type {
  ContextInvocationTargetKind,
} from "./policy.js";
import type {
  ContextSnapshotItemView,
  ContextSourceType,
} from "./types.js";

export type ContextPackingExclusionReason =
  | "CONTEXT_BUDGET_EXCLUDED"
  | "SOURCE_CONTRIBUTION_CAPPED"
  | "REDUNDANT_CANDIDATE"
  | "SENSITIVE_DATA_FILTERED"
  | "COMPACTED_STATE_NOT_REQUIRED"
  | "SUPERSEDED_CANDIDATE";

export interface PackedContextSelection {
  item: ContextSnapshotItemView;
  estimatedTokens: number;
  selectionReason:
    | "IMMEDIATE"
    | "CURRENT_SURFACE"
    | "CURRENT_PROJECT"
    | "DIRECT_REFERENCE"
    | "AUTHORITATIVE"
    | "RELEVANT"
    | "RECENT"
    | "FALLBACK";
}

export interface ContextPackingExclusion {
  item: ContextSnapshotItemView;
  reason: ContextPackingExclusionReason;
}

export interface ContextPackingResult {
  selections: PackedContextSelection[];
  exclusions: ContextPackingExclusion[];
  usedTokens: number;
  rawHistoryTokens: number;
  compactedStateRequired: boolean;
}

export interface PackContextItemsInput {
  items: readonly ContextSnapshotItemView[];
  targetKind: ContextInvocationTargetKind;
  budget: ContextBudget;
  maxSourceShare?: number;
}

type RetrievalMetadata = {
  sourceKind: string;
  reason: string | null;
  lexicalScore: number;
  directReference: boolean;
  currentSurface: boolean;
  currentProject: boolean;
  authority: "AUTHORITATIVE" | "RAW" | "DERIVED";
  occurredAt: string | null;
  estimatedTokens: number | null;
  rawHistoryTokens: number | null;
  stale: boolean;
  superseded: boolean;
};

export function packContextItems(
  input: PackContextItemsInput,
): ContextPackingResult {
  const maxSourceShare = clampRatio(input.maxSourceShare ?? 0.55);
  const selectedRawHistoryTokens = input.items
    .filter((item) => retrievalMetadata(item).sourceKind === "L1_RAW")
    .reduce((total, item) => total + estimateItemTokens(item), 0);
  const scannedRawHistoryTokens = input.items.reduce(
    (largest, item) =>
      Math.max(
        largest,
        retrievalMetadata(item).rawHistoryTokens ?? 0,
      ),
    0,
  );
  const rawHistoryTokens = Math.max(
    selectedRawHistoryTokens,
    scannedRawHistoryTokens,
  );
  const compactedStateRequired = shouldUseCompactedState(
    rawHistoryTokens,
    input.budget,
  );

  const exclusions: ContextPackingExclusion[] = [];
  const eligible = input.items.filter((item) => {
    const retrieval = retrievalMetadata(item);

    if (retrieval.superseded) {
      exclusions.push({ item, reason: "SUPERSEDED_CANDIDATE" });
      return false;
    }

    if (
      retrieval.sourceKind === "L2_COMPACTED" &&
      !compactedStateRequired
    ) {
      exclusions.push({
        item,
        reason: "COMPACTED_STATE_NOT_REQUIRED",
      });
      return false;
    }

    if (
      isExternalTarget(input.targetKind) &&
      !isImmediateUserMessage(item) &&
      containsSensitiveData(item)
    ) {
      exclusions.push({ item, reason: "SENSITIVE_DATA_FILTERED" });
      return false;
    }

    return true;
  });

  const ranked = [...eligible].sort(compareCandidates);
  const deduped: ContextSnapshotItemView[] = [];
  const seenSemantic = new Set<string>();
  for (const item of ranked) {
    const key = semanticKey(item);
    if (key && seenSemantic.has(key)) {
      exclusions.push({ item, reason: "REDUNDANT_CANDIDATE" });
      continue;
    }
    if (key) seenSemantic.add(key);
    deduped.push(item);
  }

  const effectiveBudget = input.budget.effectiveHistoryBudgetTokens;
  const sourceCap = Math.max(
    128,
    Math.floor(effectiveBudget * maxSourceShare),
  );
  const selected: PackedContextSelection[] = [];
  const selectedIds = new Set<string>();
  const sourceUsage = new Map<string, number>();
  let usedTokens = 0;

  const trySelect = (
    item: ContextSnapshotItemView,
    enforceSourceCap: boolean,
  ): boolean => {
    if (selectedIds.has(item.id)) return true;
    const estimatedTokens = estimateItemTokens(item);
    if (usedTokens + estimatedTokens > effectiveBudget) {
      exclusions.push({ item, reason: "CONTEXT_BUDGET_EXCLUDED" });
      return false;
    }

    const group = sourceGroup(item);
    const currentGroupUsage = sourceUsage.get(group) ?? 0;
    if (
      enforceSourceCap &&
      currentGroupUsage + estimatedTokens > sourceCap
    ) {
      exclusions.push({
        item,
        reason: "SOURCE_CONTRIBUTION_CAPPED",
      });
      return false;
    }

    selected.push({
      item,
      estimatedTokens,
      selectionReason: selectionReason(item),
    });
    selectedIds.add(item.id);
    usedTokens += estimatedTokens;
    sourceUsage.set(group, currentGroupUsage + estimatedTokens);
    return true;
  };

  for (const item of deduped.filter(isMandatoryContextItem)) {
    trySelect(item, false);
  }

  const nonMandatory = deduped.filter(
    (item) => !isMandatoryContextItem(item),
  );
  const bestPerGroup = new Map<string, ContextSnapshotItemView>();
  for (const item of nonMandatory) {
    const group = sourceGroup(item);
    if (!bestPerGroup.has(group)) {
      bestPerGroup.set(group, item);
    }
  }
  for (const item of bestPerGroup.values()) {
    trySelect(item, true);
  }

  for (const item of nonMandatory) {
    if (selectedIds.has(item.id)) continue;
    trySelect(item, true);
  }

  selected.sort((left, right) => compareCandidates(left.item, right.item));

  return {
    selections: selected,
    exclusions: dedupeExclusions(exclusions),
    usedTokens,
    rawHistoryTokens,
    compactedStateRequired,
  };
}

export function estimateItemTokens(item: ContextSnapshotItemView): number {
  const retrieval = retrievalMetadata(item);
  if (
    retrieval.estimatedTokens !== null &&
    retrieval.estimatedTokens > 0
  ) {
    return Math.max(1, Math.ceil(retrieval.estimatedTokens));
  }

  const serialized = JSON.stringify(stripRetrievalMetadata(item.metadata));
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function compareCandidates(
  left: ContextSnapshotItemView,
  right: ContextSnapshotItemView,
): number {
  const a = retrievalMetadata(left);
  const b = retrievalMetadata(right);

  const comparisons = [
    compareBoolean(isMandatoryContextItem(left), isMandatoryContextItem(right)),
    compareBoolean(a.currentSurface, b.currentSurface),
    compareBoolean(a.directReference, b.directReference),
    compareBoolean(a.currentProject, b.currentProject),
    authorityRank(b.authority) - authorityRank(a.authority),
    sourcePriority(a.sourceKind) - sourcePriority(b.sourceKind),
    b.lexicalScore - a.lexicalScore,
    compareBoolean(!a.stale, !b.stale),
    compareDateDesc(a.occurredAt, b.occurredAt),
    left.sequence - right.sequence,
    left.id.localeCompare(right.id),
  ];

  return comparisons.find((value) => value !== 0) ?? 0;
}

function selectionReason(
  item: ContextSnapshotItemView,
): PackedContextSelection["selectionReason"] {
  const retrieval = retrievalMetadata(item);
  if (isMandatoryContextItem(item)) return "IMMEDIATE";
  if (retrieval.currentSurface) return "CURRENT_SURFACE";
  if (retrieval.currentProject) return "CURRENT_PROJECT";
  if (retrieval.directReference) return "DIRECT_REFERENCE";
  if (retrieval.authority === "AUTHORITATIVE") return "AUTHORITATIVE";
  if (retrieval.lexicalScore > 0) return "RELEVANT";
  if (retrieval.occurredAt) return "RECENT";
  return "FALLBACK";
}

function isMandatoryContextItem(item: ContextSnapshotItemView): boolean {
  return (
    item.sourceType === "USER_MESSAGE" ||
    item.sourceType === "CONVERSATION" ||
    item.sourceType === "PARTICIPANT" ||
    item.sourceType === "LOCALE_TIMEZONE"
  );
}

function sourceGroup(item: ContextSnapshotItemView): string {
  const retrieval = retrievalMetadata(item);
  if (retrieval.sourceKind) return retrieval.sourceKind;
  return item.sourceType;
}

function sourcePriority(sourceKind: string): number {
  switch (sourceKind) {
    case "IMMEDIATE":
      return 0;
    case "L1_RAW":
      return 1;
    case "L2_COMPACTED":
      return 2;
    case "DIRECT_REFERENCE":
      return 3;
    case "PROJECT_OBJECT":
      return 4;
    case "WORKSPACE_OBJECT":
    case "FILE_METADATA":
      return 5;
    case "OLDER_HISTORY":
      return 6;
    case "PERSONAL_MEMORY":
    case "PROJECT_MEMORY":
    case "ENTITY":
      return 7;
    case "CROSS_CONVERSATION":
      return 8;
    case "ARTIFACT":
      return 9;
    default:
      return 10;
  }
}

function authorityRank(
  authority: RetrievalMetadata["authority"],
): number {
  switch (authority) {
    case "AUTHORITATIVE":
      return 3;
    case "RAW":
      return 2;
    case "DERIVED":
      return 1;
  }
}

function retrievalMetadata(
  item: ContextSnapshotItemView,
): RetrievalMetadata {
  const metadata = asRecord(item.metadata);
  const retrieval = asRecord(metadata?.retrieval);

  return {
    sourceKind:
      typeof retrieval?.sourceKind === "string"
        ? retrieval.sourceKind
        : defaultSourceKind(item.sourceType),
    reason:
      typeof retrieval?.reason === "string" ? retrieval.reason : null,
    lexicalScore: finiteNumber(retrieval?.lexicalScore, 0),
    directReference: retrieval?.directReference === true,
    currentSurface:
      retrieval?.currentSurface === true ||
      item.sourceType === "USER_MESSAGE" ||
      item.sourceType === "CONVERSATION",
    currentProject: retrieval?.currentProject === true,
    authority: parseAuthority(retrieval?.authority),
    occurredAt:
      typeof retrieval?.occurredAt === "string"
        ? retrieval.occurredAt
        : null,
    estimatedTokens:
      typeof retrieval?.estimatedTokens === "number" &&
      Number.isFinite(retrieval.estimatedTokens)
        ? retrieval.estimatedTokens
        : null,
    rawHistoryTokens:
      typeof retrieval?.rawHistoryTokens === "number" &&
      Number.isFinite(retrieval.rawHistoryTokens)
        ? retrieval.rawHistoryTokens
        : null,
    stale: retrieval?.stale === true,
    superseded: retrieval?.superseded === true,
  };
}

function defaultSourceKind(sourceType: ContextSourceType): string {
  switch (sourceType) {
    case "USER_MESSAGE":
    case "CONVERSATION":
    case "PARTICIPANT":
    case "LOCALE_TIMEZONE":
      return "IMMEDIATE";
    case "MESSAGE":
      return "L1_RAW";
    case "WORKSPACE_OBJECT":
      return "WORKSPACE_OBJECT";
    case "PROJECT":
      return "PROJECT_OBJECT";
    case "ATTACHMENT":
    case "FILE_METADATA":
      return "FILE_METADATA";
    case "ARTIFACT":
      return "ARTIFACT";
    case "COMPACTED_STATE":
      return "L2_COMPACTED";
    case "MEMORY":
      return "PERSONAL_MEMORY";
    case "ENTITY":
      return "ENTITY";
    case "AUDIENCE":
      return "IMMEDIATE";
  }
}

function parseAuthority(
  value: unknown,
): RetrievalMetadata["authority"] {
  return value === "AUTHORITATIVE" ||
    value === "RAW" ||
    value === "DERIVED"
    ? value
    : "RAW";
}

function semanticKey(item: ContextSnapshotItemView): string | null {
  const text = collectSemanticText(
    stripRetrievalMetadata(item.metadata),
  )
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 32) return null;
  return text;
}

function isImmediateUserMessage(
  item: ContextSnapshotItemView,
): boolean {
  const retrieval = retrievalMetadata(item);
  return (
    item.sourceType === "USER_MESSAGE" &&
    retrieval.sourceKind === "IMMEDIATE" &&
    retrieval.currentSurface &&
    retrieval.directReference
  );
}

function containsSensitiveData(item: ContextSnapshotItemView): boolean {
  const safeMetadata = stripRetrievalMetadata(item.metadata);
  const text = [
    collectSemanticText(safeMetadata),
    JSON.stringify(safeMetadata),
  ].join("\n");
  if (!text) return false;

  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\b["']?(?:password|passwd|пароль)["']?\s*[:=]\s*["']?\S{4,}/i,
    /\b["']?(?:api[_ -]?key|secret|client[_ -]?secret)["']?\s*[:=]\s*["']?\S{6,}/i,
    /\b["']?(?:otp|one[- ]time code|одноразов(?:ый|ого) код)["']?\s*[:=]\s*["']?\d{4,10}\b/i,
  ].some((pattern) => pattern.test(text));
}

function stripRetrievalMetadata(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const { retrieval: _retrieval, ...rest } = record;
  return rest;
}

function collectSemanticText(value: unknown): string {
  const parts: string[] = [];
  collectStrings(value, parts, 0);
  return parts.join("\n");
}

function collectStrings(
  value: unknown,
  parts: string[],
  depth: number,
): void {
  if (depth > 5) return;
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 64)) {
      collectStrings(item, parts, depth + 1);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, entry] of Object.entries(record)) {
    if (
      key === "retrieval" ||
      key.endsWith("Id") ||
      key === "fingerprint" ||
      key === "createdAt" ||
      key === "updatedAt" ||
      key === "archivedAt" ||
      key === "deletedAt" ||
      key === "completedAt" ||
      key === "pinnedAt"
    ) {
      continue;
    }
    collectStrings(entry, parts, depth + 1);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function compareBoolean(left: boolean, right: boolean): number {
  if (left === right) return 0;
  return left ? -1 : 1;
}

function compareDateDesc(
  left: string | null,
  right: string | null,
): number {
  const a = left ? Date.parse(left) : Number.NaN;
  const b = right ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return 1;
  if (!Number.isFinite(b)) return -1;
  return b - a;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.55;
  return Math.min(0.9, Math.max(0.2, value));
}

function isExternalTarget(
  targetKind: ContextInvocationTargetKind,
): boolean {
  return (
    targetKind === "AI_AUTO" ||
    targetKind === "AI_MODEL" ||
    targetKind === "AGENT"
  );
}

function dedupeExclusions(
  exclusions: ContextPackingExclusion[],
): ContextPackingExclusion[] {
  const seen = new Set<string>();
  return exclusions.filter(({ item, reason }) => {
    const key = item.id + ":" + reason;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
