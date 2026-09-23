export interface DirectChatConsent {
  actorShareOwnHistoryWithVimla: boolean;
  actorIncludePeerHistoryWhenInvoking: boolean;
  peerShareOwnHistoryWithVimla: boolean;
}

export interface ContextMessageClaim {
  messageId: string;
  senderUserId: string;
  sentAt: string;
  text: string;
}

export function filterOperatorContextBundle(input: {
  actorUserId: string;
  memberIds: readonly string[];
  consent: DirectChatConsent;
  messages: readonly ContextMessageClaim[];
}): {
  messages: ContextMessageClaim[];
  ownIncluded: boolean;
  peerIncluded: boolean;
  peerDenied: boolean;
} {
  const allowed: ContextMessageClaim[] = [];
  let ownIncluded = false;
  let peerIncluded = false;
  let peerDenied = false;

  for (const message of input.messages) {
    if (!input.memberIds.includes(message.senderUserId)) {
      continue;
    }
    if (message.senderUserId === input.actorUserId) {
      if (!input.consent.actorShareOwnHistoryWithVimla) {
        continue;
      }
      ownIncluded = true;
      allowed.push(message);
      continue;
    }
    if (!input.consent.actorIncludePeerHistoryWhenInvoking || !input.consent.peerShareOwnHistoryWithVimla) {
      peerDenied = true;
      continue;
    }
    peerIncluded = true;
    allowed.push(message);
  }

  return { messages: allowed, ownIncluded, peerIncluded, peerDenied };
}
