import type { MentionCandidate, MentionCandidateKind, MessageMentionInput } from "@vimla/contracts";

export type ComposerMention = MessageMentionInput & {
  localId: string;
};

type MentionToken = {
  canonicalHandle: string;
  startOffset: number;
  endOffset: number;
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

export function resolveTypedComposerMentions(
  text: string,
  candidates: MentionCandidate[],
): ComposerMention[] {
  const candidateByHandle = new Map(
    candidates.map((candidate) => [candidate.handle.toLowerCase(), candidate] as const),
  );

  return findMentionTokens(text).flatMap((token, index) => {
    const candidate = candidateByHandle.get(token.canonicalHandle);
    if (!candidate) return [];
    return [
      createComposerMention({
        localId: `resolved-${index}-${token.startOffset}`,
        handleId: candidate.id,
        kind: candidate.kind,
        canonicalHandle: candidate.handle,
        startOffset: token.startOffset,
      }),
    ];
  });
}

export function toMessageMentionInputs(mentions: ComposerMention[]): MessageMentionInput[] {
  return mentions.map((mention) => ({
    handleId: mention.handleId,
    kind: mention.kind,
    canonicalHandle: mention.canonicalHandle,
    startOffset: mention.startOffset,
    endOffset: mention.endOffset,
  }));
}

function findMentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const matcher = /@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
  const handleCharacter = /[A-Za-z0-9._-]/;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const startOffset = match.index;
    const before = startOffset > 0 ? text[startOffset - 1] ?? "" : "";
    if (handleCharacter.test(before)) continue;

    let rawHandle = match[1] ?? "";
    while (/[._-]$/.test(rawHandle)) rawHandle = rawHandle.slice(0, -1);
    if (rawHandle.length === 0) continue;

    const endOffset = startOffset + rawHandle.length + 1;
    const after = text[endOffset] ?? "";
    if (handleCharacter.test(after)) continue;

    tokens.push({
      canonicalHandle: rawHandle.toLowerCase(),
      startOffset,
      endOffset,
    });
  }

  return tokens;
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
