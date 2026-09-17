import type { MentionCandidateKind, MessageMentionInput } from "@vimla/contracts";

export type ComposerMention = MessageMentionInput & {
  localId: string;
};

export function reconcileComposerMentions(
  previousText: string,
  nextText: string,
  mentions: ComposerMention[],
): ComposerMention[] {
  if (previousText === nextText || mentions.length === 0) return mentions;

  const change = findChange(previousText, nextText);
  const delta = (change.nextEnd - change.start) - (change.previousEnd - change.start);

  return mentions.flatMap((mention) => {
    let nextMention = mention;

    if (change.previousEnd <= mention.startOffset) {
      nextMention = {
        ...mention,
        startOffset: mention.startOffset + delta,
        endOffset: mention.endOffset + delta,
      };
    } else if (change.start >= mention.endOffset) {
      nextMention = mention;
    } else {
      return [];
    }

    return mentionTokenIsValid(nextText, nextMention) ? [nextMention] : [];
  });
}

export function createComposerMention(input: {
  localId: string;
  handleId: string;
  kind: MentionCandidateKind;
  canonicalHandle: string;
  startOffset: number;
}): ComposerMention {
  return {
    localId: input.localId,
    handleId: input.handleId,
    kind: input.kind,
    canonicalHandle: input.canonicalHandle,
    startOffset: input.startOffset,
    endOffset: input.startOffset + input.canonicalHandle.length + 1,
  };
}

export function toMessageMentionInputs(mentions: ComposerMention[]): MessageMentionInput[] {
  return mentions.map(({ localId: _localId, ...mention }) => mention);
}

function findChange(previousText: string, nextText: string): {
  start: number;
  previousEnd: number;
  nextEnd: number;
} {
  let start = 0;
  const prefixLimit = Math.min(previousText.length, nextText.length);
  while (start < prefixLimit && previousText[start] === nextText[start]) start += 1;

  let previousEnd = previousText.length;
  let nextEnd = nextText.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { start, previousEnd, nextEnd };
}

function mentionTokenIsValid(text: string, mention: ComposerMention): boolean {
  if (mention.startOffset < 0 || mention.endOffset > text.length) return false;
  if (text.slice(mention.startOffset, mention.endOffset) !== `@${mention.canonicalHandle}`) return false;

  const before = mention.startOffset > 0 ? text[mention.startOffset - 1] ?? "" : "";
  const after = text[mention.endOffset] ?? "";
  const handleCharacter = /[A-Za-z0-9._-]/;
  return !handleCharacter.test(before) && !handleCharacter.test(after);
}
