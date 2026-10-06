export interface DirectChatParticipant {
  userId: string;
  handle: string;
  name: string;
}

export type AssigneeResolution =
  | { type: "self" }
  | { type: "peer"; userId: string }
  | { type: "clarify" }
  | { type: "denied" };

const SELF_HINTS = new Set(["me", "myself", "мне", "себе", "меня", "я"]);

export function resolveDirectChatAssignee(
  hint: string | undefined,
  actorUserId: string,
  participants: readonly DirectChatParticipant[],
): AssigneeResolution {
  if (!hint || hint.trim().length === 0) {
    return { type: "self" };
  }
  const normalized = normalizeIdentity(hint);
  if (SELF_HINTS.has(normalized)) {
    return { type: "self" };
  }

  const matches = participants.filter((participant) => identityMatches(participant, normalized));
  if (matches.length === 1) {
    const match = matches[0];
    if (!match) {
      return { type: "denied" };
    }
    return match.userId === actorUserId ? { type: "self" } : { type: "peer", userId: match.userId };
  }
  if (matches.length > 1) {
    return { type: "clarify" };
  }
  return { type: "denied" };
}

function identityMatches(participant: DirectChatParticipant, hint: string): boolean {
  const name = normalizeIdentity(participant.name);
  const handle = normalizeIdentity(participant.handle.startsWith("@") ? participant.handle.slice(1) : participant.handle);
  const normalizedHint = hint.startsWith("@") ? hint.slice(1) : hint;
  if (name === normalizedHint || handle === normalizedHint) {
    return true;
  }
  const stemLength = Math.min(5, name.length, normalizedHint.length);
  return stemLength >= 4 && name.slice(0, stemLength) === normalizedHint.slice(0, stemLength);
}

function normalizeIdentity(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}
