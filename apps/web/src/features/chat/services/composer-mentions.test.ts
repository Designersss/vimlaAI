import { describe, expect, it } from "vitest";
import {
  createComposerMention,
  reconcileComposerMentions,
  resolveTypedComposerMentions,
  toMessageMentionInputs,
} from "./composer-mentions";

function mention(startOffset = 0) {
  return createComposerMention({
    localId: "local-1",
    handleId: "system:vimla",
    kind: "SYSTEM_AGENT",
    canonicalHandle: "vimla",
    startOffset,
  });
}

const vimlaCandidate = {
  id: "system:vimla",
  kind: "SYSTEM_AGENT" as const,
  handle: "vimla",
  label: "Vimla",
  description: null,
  avatarUrl: null,
  role: null,
};

const autoCandidate = {
  id: "system:auto",
  kind: "AI_AUTO" as const,
  handle: "auto",
  label: "Auto",
  description: null,
  avatarUrl: null,
  role: null,
};

describe("composer mentions", () => {
  it("creates canonical occurrence metadata", () => {
    expect(mention()).toEqual({
      localId: "local-1",
      handleId: "system:vimla",
      kind: "SYSTEM_AGENT",
      canonicalHandle: "vimla",
      startOffset: 0,
      endOffset: 6,
    });
  });

  it("shifts a selected mention when text is inserted before it", () => {
    const result = reconcileComposerMentions("@vimla run", "hey @vimla run", [mention()]);
    expect(result).toEqual([{ ...mention(), startOffset: 4, endOffset: 10 }]);
  });

  it("keeps metadata when editing after the mention", () => {
    const result = reconcileComposerMentions("@vimla run", "@vimla run this", [mention()]);
    expect(result).toEqual([mention()]);
  });

  it("invalidates metadata when editing inside the mention", () => {
    const result = reconcileComposerMentions("@vimla run", "@vimlax run", [mention()]);
    expect(result).toEqual([]);
  });

  it("resolves manually typed exact handles before send", () => {
    expect(resolveTypedComposerMentions("@vimla run with @auto", [vimlaCandidate, autoCandidate])).toEqual([
      {
        localId: "resolved-0-0",
        handleId: "system:vimla",
        kind: "SYSTEM_AGENT",
        canonicalHandle: "vimla",
        startOffset: 0,
        endOffset: 6,
      },
      {
        localId: "resolved-1-16",
        handleId: "system:auto",
        kind: "AI_AUTO",
        canonicalHandle: "auto",
        startOffset: 16,
        endOffset: 21,
      },
    ]);
  });

  it("leaves unknown mention-looking text unresolved", () => {
    expect(resolveTypedComposerMentions("hello @unknown", [vimlaCandidate])).toEqual([]);
  });

  it("resolves repeated exact mentions as distinct occurrences", () => {
    const resolved = resolveTypedComposerMentions("@auto then @auto", [autoCandidate]);
    expect(resolved.map(({ startOffset, endOffset }) => ({ startOffset, endOffset }))).toEqual([
      { startOffset: 0, endOffset: 5 },
      { startOffset: 11, endOffset: 16 },
    ]);
  });

  it("strips local-only ids from the send payload", () => {
    expect(toMessageMentionInputs([mention()])).toEqual([
      {
        handleId: "system:vimla",
        kind: "SYSTEM_AGENT",
        canonicalHandle: "vimla",
        startOffset: 0,
        endOffset: 6,
      },
    ]);
  });
});
