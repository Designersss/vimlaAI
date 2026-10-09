export { ChatWorkspaceStore, ConversationState } from "./chat-workspace-store.js";
export {
  boundDirectChatContextBefore,
  prepareDirectChatContext,
  type DirectChatPlaintextRecord,
  type PreparedDirectChatContext,
} from "./direct-chat-context.js";
export { advanceDirectHistoryHead, reconcileDirectHistoryHead, applyDirectPrivacyAcknowledgement } from "./direct-chat-history-head.js";
export { directMessageReplicaFingerprint, sameDirectMessageReplica, hasConflictingDirectMessageReplicas, mergeDirectMessageReplicaRows, type DirectMessageReplicaRow } from "./direct-chat-message-replica.js";
export { validateDirectReactionLookupPage } from "./direct-chat-reaction-history-lookup.js";
export {
  DIRECT_HISTORY_CATCHUP_MAX_PAGES,
  assertDirectHistoryCatchupBudget,
  DEEP_HISTORY_BOOTSTRAP_MAX_PAGES,
  pageUnlocksHistoryBootstrap,
  shouldContinueDeepHistoryBootstrap,
} from "./direct-chat-history-bootstrap.js";
export {
  RATCHET_RECORD_SCHEMA_VERSION,
  LEGACY_RATCHET_RECORD_SCHEMA_VERSION,
  RatchetLockLostError,
  RatchetStateConflictError,
  RatchetStateCorruptError,
  acquireRatchetLeaseRecord,
  assertRatchetVersion,
  canAcquireRatchetLease,
  decodeStoredRatchet,
  isRatchetLeaseRecord,
  markLegacyRatchetOwner,
  renewRatchetLeaseRecord,
  storedRatchetRecord,
  type RatchetLeaseRecord,
  type RatchetSnapshot,
  type StoredLegacyRatchetRecord,
  type StoredRatchetRecord,
} from "./direct-chat-ratchet-coordination.js";
export {
  SyncEngine,
  retryDelay,
  type SyncCursorStore,
  type SyncDeltaSink,
  type SyncEngineOptions,
  type SyncEngineState,
  type SyncFailureKind,
  type SyncPageSource,
} from "./sync-engine.js";

export {
  resolveInboxPreview,
  type InboxLocalPlaintextRecord,
} from "./inbox-preview.js";
export {
  directReplyReference,
  readDirectReplyReference,
  resolveDirectReplySource,
  type DirectReplyReference,
  type LocalDirectReplySource,
} from "./direct-chat-replies.js";
export {
  cachedDirectPlaintextMatchesMessage,
  type CachedDirectPlaintextProvenance,
} from "./direct-chat-cached-provenance.js";
export {
  encodeDirectHumanPayload,
  decodeDirectHumanPayload,
  directHumanClientMessageId,
  directHumanContentCommitment,
  createDirectHumanMessage,
  type HumanPayload,
} from "./direct-chat-human-payload.js";

export {
  DIRECT_REACTION_EMOJIS,
  isDirectReactionEmoji,
  directReactionTargetTag,
  createDirectReaction,
  decodeDirectReaction,
  resolveDirectReactionSource,
  verifyDirectReaction,
  type DirectReactionEmoji,
  type DirectReactionAction,
  type DirectReactionPayload,
  type PreparedDirectReaction,
  type SignedDirectReactionMetadata,
  type VerifiedDirectReaction,
} from "./direct-chat-reactions.js";
export {
  reduceVerifiedDirectReactions,
  type DirectReactionState,
} from "./direct-chat-reaction-state.js";
export {
  projectVerifiedDirectReactions,
  type CachedDirectReactionPlaintext,
  type ReactionProjectionRow,
  type DirectReactionsProjection,
} from "./direct-chat-reaction-projection.js";
