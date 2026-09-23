import { describe, expect, it } from "vitest";
import type { ContextBudget } from "./budget.js";
import { packContextItems } from "./packer.js";
import type { ContextSnapshotItemView } from "./types.js";

const SMALL_BUDGET: ContextBudget = {
  contextWindowTokens: 2_000,
  outputReserveTokens: 300,
  systemToolReserveTokens: 200,
  artifactReserveTokens: 100,
  safetyMarginTokens: 100,
  effectiveHistoryBudgetTokens: 1_300,
  compactedStateTriggerTokens: 900,
};

describe("ContextPacker", () => {
  it("uses raw history without L2 while the effective history budget is comfortable", () => {
    const result = packContextItems({
      targetKind: "AI_MODEL",
      budget: SMALL_BUDGET,
      items: [
        item("user", "USER_MESSAGE", "current request", {
          sourceKind: "IMMEDIATE",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 40,
        }),
        item("raw-1", "MESSAGE", "recent raw history", {
          sourceKind: "L1_RAW",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 200,
        }),
        item("l2", "COMPACTED_STATE", "older compacted state", {
          sourceKind: "L2_COMPACTED",
          currentSurface: true,
          authority: "DERIVED",
          estimatedTokens: 180,
        }),
      ],
    });

    expect(result.compactedStateRequired).toBe(false);
    expect(result.selections.map(({ item: selected }) => selected.id)).toEqual([
      "user",
      "raw-1",
    ]);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ id: "l2" }),
          reason: "COMPACTED_STATE_NOT_REQUIRED",
        }),
      ]),
    );
  });

  it("admits L2 only when raw history crosses the budget-derived compaction threshold", () => {
    const result = packContextItems({
      targetKind: "VIMLA",
      budget: SMALL_BUDGET,
      items: [
        item("user", "USER_MESSAGE", "current request", {
          sourceKind: "IMMEDIATE",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 40,
        }),
        item("raw-1", "MESSAGE", "large recent history one", {
          sourceKind: "L1_RAW",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 500,
        }),
        item("raw-2", "MESSAGE", "large recent history two", {
          sourceKind: "L1_RAW",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 450,
        }),
        item("l2", "COMPACTED_STATE", "compacted older state", {
          sourceKind: "L2_COMPACTED",
          currentSurface: true,
          authority: "DERIVED",
          estimatedTokens: 100,
        }),
      ],
    });

    expect(result.rawHistoryTokens).toBe(950);
    expect(result.compactedStateRequired).toBe(true);
    expect(result.selections.map(({ item: selected }) => selected.id)).toContain("l2");
  });

  it("preserves source diversity and prevents a long raw tail from crowding out structured context", () => {
    const result = packContextItems({
      targetKind: "VIMLA",
      budget: {
        ...SMALL_BUDGET,
        effectiveHistoryBudgetTokens: 700,
        compactedStateTriggerTokens: 650,
      },
      maxSourceShare: 0.5,
      items: [
        item("user", "USER_MESSAGE", "current request", {
          sourceKind: "IMMEDIATE",
          currentSurface: true,
          authority: "RAW",
          estimatedTokens: 50,
        }),
        ...Array.from({ length: 6 }, (_, index) =>
          item(
            "raw-" + index,
            "MESSAGE",
            "same noisy chat entry " + index,
            {
              sourceKind: "L1_RAW",
              currentSurface: true,
              authority: "RAW",
              estimatedTokens: 150,
              lexicalScore: 0.7 - index * 0.01,
            },
          ),
        ),
        item("workspace", "WORKSPACE_OBJECT", "authoritative task", {
          sourceKind: "WORKSPACE_OBJECT",
          authority: "AUTHORITATIVE",
          estimatedTokens: 120,
          lexicalScore: 0.5,
        }),
        item("project", "PROJECT", "current project fact", {
          sourceKind: "PROJECT_OBJECT",
          authority: "AUTHORITATIVE",
          currentProject: true,
          estimatedTokens: 120,
          lexicalScore: 0.4,
        }),
      ],
    });

    const ids = result.selections.map(({ item: selected }) => selected.id);
    expect(ids).toContain("workspace");
    expect(ids).toContain("project");
    expect(ids.filter((id) => id.startsWith("raw-")).length).toBeLessThan(4);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(
            /SOURCE_CONTRIBUTION_CAPPED|CONTEXT_BUDGET_EXCLUDED/,
          ),
        }),
      ]),
    );
  });

  it("filters retrieved secrets before external-model packing without dropping the user's immediate request", () => {
    const result = packContextItems({
      targetKind: "AI_MODEL",
      budget: SMALL_BUDGET,
      items: [
        item("user", "USER_MESSAGE", "password: user-explicit-value", {
          sourceKind: "IMMEDIATE",
          currentSurface: true,
          directReference: true,
          authority: "RAW",
          estimatedTokens: 40,
        }),
        item("retrieved", "MESSAGE", "password: leaked-from-history", {
          sourceKind: "CROSS_CONVERSATION",
          authority: "RAW",
          estimatedTokens: 40,
          lexicalScore: 0.9,
        }),
      ],
    });

    expect(result.selections.map(({ item: selected }) => selected.id)).toContain("user");
    expect(result.selections.map(({ item: selected }) => selected.id)).not.toContain("retrieved");
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ id: "retrieved" }),
          reason: "SENSITIVE_DATA_FILTERED",
        }),
      ]),
    );
  });

  it("drops superseded derived memory and boosts current-project authoritative facts", () => {
    const result = packContextItems({
      targetKind: "VIMLA",
      budget: SMALL_BUDGET,
      items: [
        item("global-memory", "MEMORY", "old project status", {
          sourceKind: "PERSONAL_MEMORY",
          authority: "DERIVED",
          estimatedTokens: 80,
          lexicalScore: 0.95,
          stale: true,
        }),
        item("current-project", "PROJECT", "current project status", {
          sourceKind: "PROJECT_OBJECT",
          authority: "AUTHORITATIVE",
          currentProject: true,
          estimatedTokens: 80,
          lexicalScore: 0.5,
        }),
        item("superseded", "MEMORY", "superseded project status", {
          sourceKind: "PROJECT_MEMORY",
          authority: "DERIVED",
          estimatedTokens: 80,
          lexicalScore: 1,
          superseded: true,
        }),
      ],
    });

    expect(result.selections[0]?.item.id).toBe("current-project");
    expect(result.selections.map(({ item: selected }) => selected.id)).not.toContain("superseded");
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ id: "superseded" }),
          reason: "SUPERSEDED_CANDIDATE",
        }),
      ]),
    );
  });

  it("deduplicates semantically identical candidates deterministically", () => {
    const first = item(
      "first",
      "MESSAGE",
      "A sufficiently long repeated semantic candidate about release architecture",
      {
        sourceKind: "OLDER_HISTORY",
        authority: "RAW",
        estimatedTokens: 40,
        lexicalScore: 0.8,
      },
    );
    const second = item(
      "second",
      "MESSAGE",
      "A sufficiently long repeated semantic candidate about release architecture",
      {
        sourceKind: "CROSS_CONVERSATION",
        authority: "RAW",
        estimatedTokens: 40,
        lexicalScore: 0.6,
      },
    );

    const result = packContextItems({
      targetKind: "VIMLA",
      budget: SMALL_BUDGET,
      items: [first, second],
    });

    expect(result.selections.map(({ item: selected }) => selected.id)).toEqual(["first"]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: "second" }),
        reason: "REDUNDANT_CANDIDATE",
      }),
    ]);
  });
});

function item(
  id: string,
  sourceType: ContextSnapshotItemView["sourceType"],
  content: string,
  retrieval: {
    sourceKind: string;
    authority: "AUTHORITATIVE" | "RAW" | "DERIVED";
    estimatedTokens: number;
    lexicalScore?: number;
    currentSurface?: boolean;
    currentProject?: boolean;
    directReference?: boolean;
    stale?: boolean;
    superseded?: boolean;
  },
): ContextSnapshotItemView {
  return {
    id,
    sequence: 0,
    sourceType,
    sourceId: id,
    sourceVersion: "v1",
    classification: "PRIVATE",
    contentRef: null,
    metadata: {
      content,
      retrieval: {
        sourceKind: retrieval.sourceKind,
        authority: retrieval.authority,
        estimatedTokens: retrieval.estimatedTokens,
        lexicalScore: retrieval.lexicalScore ?? 0,
        currentSurface: retrieval.currentSurface ?? false,
        currentProject: retrieval.currentProject ?? false,
        directReference: retrieval.directReference ?? false,
        stale: retrieval.stale ?? false,
        superseded: retrieval.superseded ?? false,
        occurredAt: "2026-09-23T00:00:00.000Z",
      },
    },
    fingerprint: "sha256:" + id,
    createdAt: "2026-09-23T00:00:00.000Z",
  };
}
