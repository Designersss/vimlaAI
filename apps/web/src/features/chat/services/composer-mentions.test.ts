import { describe, expect, it } from "vitest";
import {
  createComposerMention,
  reconcileComposerMentions,
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

  it("does not create metadata for pasted mention-looking plaintext", () => {
    expect(reconcileComposerMentions("", "@vimla", [])).toEqual([]);
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
