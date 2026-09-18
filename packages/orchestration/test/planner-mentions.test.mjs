import assert from "node:assert/strict";
import test from "node:test";
import {
  invocationTargetForPlannerMention,
  toPlannerInvocationMentions,
  withPlannerMentionRole,
} from "../dist/index.js";

function mention(overrides = {}) {
  return {
    id: "mention-1",
    handleId: "handle-auto",
    kind: "AI_AUTO",
    targetId: "AI_AUTO",
    canonicalHandle: "auto",
    startOffset: 0,
    endOffset: 5,
    ...overrides,
  };
}

test("scenario A: preserves repeated @auto occurrences as distinct planner constraints", () => {
  const mentions = toPlannerInvocationMentions([
    mention({
      id: "auto-a",
      startOffset: 0,
      endOffset: 5,
    }),
    mention({
      id: "auto-b",
      startOffset: 28,
      endOffset: 33,
    }),
    mention({
      id: "auto-c",
      startOffset: 40,
      endOffset: 45,
    }),
  ]);

  assert.equal(mentions.length, 3);
  assert.deepEqual(
    mentions.map((item) => ({
      occurrenceId: item.occurrenceId,
      occurrenceIndex: item.occurrenceIndex,
      target: item.target,
    })),
    [
      {
        occurrenceId: "auto-a",
        occurrenceIndex: 0,
        target: { kind: "AI_AUTO", systemKey: "AI_AUTO" },
      },
      {
        occurrenceId: "auto-b",
        occurrenceIndex: 1,
        target: { kind: "AI_AUTO", systemKey: "AI_AUTO" },
      },
      {
        occurrenceId: "auto-c",
        occurrenceIndex: 2,
        target: { kind: "AI_AUTO", systemKey: "AI_AUTO" },
      },
    ],
  );

  assert.deepEqual(
    mentions.map((item) => invocationTargetForPlannerMention(item)),
    [{ kind: "AI_AUTO" }, { kind: "AI_AUTO" }, { kind: "AI_AUTO" }],
  );
});

test("scenario B: evaluator role is semantic planner output, not keyword inference", () => {
  const mentions = toPlannerInvocationMentions([
    mention({
      id: "auto-generate",
      startOffset: 0,
      endOffset: 5,
    }),
    mention({
      id: "auto-evaluate",
      startOffset: 30,
      endOffset: 35,
    }),
    mention({
      id: "vimla-action",
      handleId: "handle-vimla",
      kind: "SYSTEM_AGENT",
      targetId: "VIMLA",
      canonicalHandle: "vimla",
      startOffset: 60,
      endOffset: 66,
    }),
    mention({
      id: "user-denis",
      handleId: "handle-denis",
      kind: "USER",
      targetId: "user-denis",
      canonicalHandle: "denis",
      startOffset: 80,
      endOffset: 86,
    }),
  ]);

  assert.deepEqual(
    mentions.map((item) => item.occurrenceId),
    ["auto-generate", "auto-evaluate", "vimla-action"],
  );

  const evaluator = withPlannerMentionRole(mentions[1], "EVALUATION");
  assert.equal(evaluator.semanticRole, "EVALUATION");
  assert.equal(mentions[1].semanticRole, null);

  assert.deepEqual(invocationTargetForPlannerMention(mentions[2]), {
    kind: "VIMLA",
  });
});

test("scenario C: preserves exact model identity while mapping plan target by exact slug", () => {
  const mentions = toPlannerInvocationMentions([
    mention({
      id: "fixed-model",
      handleId: "handle-gpt",
      kind: "AI_MODEL",
      targetId: "model-db-id-gpt-5-6-luna",
      canonicalHandle: "gpt-5-6-luna",
      startOffset: 0,
      endOffset: 15,
    }),
    mention({
      id: "auto-review",
      startOffset: 32,
      endOffset: 37,
    }),
  ]);

  assert.deepEqual(mentions[0].target, {
    kind: "AI_MODEL",
    modelId: "model-db-id-gpt-5-6-luna",
    modelSlug: "gpt-5-6-luna",
  });
  assert.deepEqual(invocationTargetForPlannerMention(mentions[0]), {
    kind: "AI_MODEL",
    modelSlug: "gpt-5-6-luna",
  });
  assert.deepEqual(invocationTargetForPlannerMention(mentions[1]), {
    kind: "AI_AUTO",
  });
});

test("scenario D: one @auto occurrence remains one planner constraint for a compound task", () => {
  const mentions = toPlannerInvocationMentions([
    mention({
      id: "compound-auto",
      startOffset: 0,
      endOffset: 5,
    }),
  ]);

  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].occurrenceId, "compound-auto");
  assert.equal(mentions[0].semanticRole, null);
});

test("sorts by occurrence range instead of trusting caller order", () => {
  const mentions = toPlannerInvocationMentions([
    mention({ id: "second", startOffset: 20, endOffset: 25 }),
    mention({ id: "first", startOffset: 0, endOffset: 5 }),
  ]);

  assert.deepEqual(
    mentions.map((item) => item.occurrenceId),
    ["first", "second"],
  );
  assert.deepEqual(
    mentions.map((item) => item.occurrenceIndex),
    [0, 1],
  );
});

test("rejects duplicate occurrence ids", () => {
  assert.throws(
    () =>
      toPlannerInvocationMentions([
        mention({ id: "duplicate", startOffset: 0, endOffset: 5 }),
        mention({ id: "duplicate", startOffset: 10, endOffset: 15 }),
      ]),
    /Duplicate mention occurrence id/,
  );
});

test("rejects overlapping ranges", () => {
  assert.throws(
    () =>
      toPlannerInvocationMentions([
        mention({ id: "first", startOffset: 0, endOffset: 5 }),
        mention({ id: "second", startOffset: 4, endOffset: 9 }),
      ]),
    /Mention ranges cannot overlap/,
  );
});

test("rejects forged Vimla and Auto system mappings", () => {
  assert.throws(
    () =>
      toPlannerInvocationMentions([
        mention({
          id: "fake-vimla",
          handleId: "handle-vimla",
          kind: "SYSTEM_AGENT",
          targetId: "OTHER_SYSTEM",
          canonicalHandle: "vimla",
        }),
      ]),
    /must resolve to @vimla/,
  );

  assert.throws(
    () =>
      toPlannerInvocationMentions([
        mention({
          id: "fake-auto",
          targetId: "OTHER_AUTO",
        }),
      ]),
    /must resolve to @auto/,
  );
});

test("rejects exact model mentions without stable model identity", () => {
  assert.throws(
    () =>
      toPlannerInvocationMentions([
        mention({
          id: "model",
          handleId: "handle-model",
          kind: "AI_MODEL",
          targetId: null,
          canonicalHandle: "gpt-5-6-luna",
        }),
      ]),
    /requires a stable model target id/,
  );
});
