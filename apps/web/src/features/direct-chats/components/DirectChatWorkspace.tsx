"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { DIRECT_CHAT_LIMITS } from "@vimla/contracts";
import type {
  DirectConversationView,
  DirectMessageKind,
  DirectMessageReportEvidence,
  DirectMessageView,
  MentionSuggestionsResponse,
  MessageMentionInput,
  OperatorRunView,
} from "@vimla/contracts";
import {
  Alert,
  AssistantMessage,
  Badge,
  Button,
  Card,
  ChatComposer,
  Dialog,
  EmptyState,
  MentionPicker,
  Switch,
  Text,
  UserMessage,
  type MentionPickerOption,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../auth/services/current-user";
import { OperatorRunPanel } from "../../operator/components/OperatorRunPanel";
import {
  OperatorRequestError,
  cancelOperatorRun,
  confirmOperatorRun,
  createOperatorRun,
  fetchOperatorRun,
} from "../../operator/services/operator";
import { fetchMentionSuggestions } from "../../chat/services/mentions";
import {
  createComposerMention,
  reconcileComposerMentions,
  resolveTypedComposerMentions,
  toMessageMentionInputs,
  type ComposerMention,
} from "../../chat/services/composer-mentions";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import { ReportUserDialog } from "../../trust/components/ReportUserDialog";
import {
  blockUser,
  fetchSurfacePreference,
  updateSurfacePreference,
} from "../../trust/services/api";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../shared/i18n/persist-locale";
import {
  DirectChatsApiError,
  fetchDirectConversation,
  fetchDirectMessages,
  markDirectChatRead,
  prepareDirectMessageSend,
  updateDirectChatPrivacy,
} from "../services/api";
import {
  PendingOperatorInvocationGoneError,
  cancelPendingSendsForTrust,
  loadConversationPlaintexts,
  loadPendingSends,
  type StoredOperatorIntent,
  type StoredOperatorOutputDraft,
  type StoredOperatorOutputLink,
} from "../services/crypto-store";
import {
  RatchetLockLostError,
  boundDirectChatContextBefore,
  pageUnlocksHistoryBootstrap,
  prepareDirectChatContext,
  shouldContinueDeepHistoryBootstrap,
} from "@vimla/client-core";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "../services/payload";
import {
  decryptMessageWithStatus,
  discardPendingOperatorInvocation,
  encryptForDevices,
  ensureLocalDevice,
  finalizePendingOperatorInvocation,
  finalizePendingSend,
  loadPendingOperatorInvocations,
  recoverPendingSends,
  sendPendingDirectMessage,
  stagePendingOperatorInvocationDelivery,
  withPendingOperatorInvocationLock,
  type PendingOperatorInvocation,
} from "../services/session";
import { useChatSyncHub, useChatWorkspace, usePrepareChatDevice } from "../../chat/components/ChatWorkspace/ChatWorkspaceProvider";
import { ChatConversationHeader } from "../../chat/components/ChatWorkspace/ChatConversationHeader";
import { ChatDetailStatus } from "../../chat/components/ChatWorkspace/ChatDetailStatus";
import styles from "./DirectChatWorkspace.module.scss";
import { TRUST_CANCELLED_GC_POLL_INTERVAL_MS } from "../services/trust-cancelled-gc";

interface DecryptedRow {
  message: DirectMessageView;
  payload: DirectPlaintextPayload | null;
  needsBootstrap: boolean;
}

const OPERATOR_RECOVERY_REQUEST_TIMEOUT_MS = 20_000;

type ActiveMentionQuery = {
  start: number;
  end: number;
  query: string;
};

async function markObservedDirectMessagesRead(
  conversationId: string,
  messageIds: readonly string[],
  fallback: DirectConversationView,
): Promise<DirectConversationView> {
  const uniqueIds = [...new Set(messageIds)];
  if (uniqueIds.length === 0) {
    return fallback;
  }

  let current = fallback;
  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += DIRECT_CHAT_LIMITS.pageLimitMax
  ) {
    current = await markDirectChatRead(
      conversationId,
      {
        seenMessageIds: uniqueIds.slice(
          offset,
          offset + DIRECT_CHAT_LIMITS.pageLimitMax,
        ),
      },
    );
  }
  return current;
}

function findActiveMention(value: string): ActiveMentionQuery | null {
  const match = /(?:^|\s)@([a-zA-Z0-9._-]*)$/.exec(value);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    start: value.length - query.length - 1,
    end: value.length,
    query,
  };
}

function exactMentionOption(options: MentionPickerOption[], query: string): MentionPickerOption | null {
  if (query.length === 0) return null;
  const normalized = query.toLowerCase();
  return options.find((option) => option.handle.toLowerCase() === normalized) ?? null;
}

function upsertComposerMention(current: ComposerMention[], mention: ComposerMention): ComposerMention[] {
  return [...current.filter((item) => item.startOffset !== mention.startOffset), mention].sort(
    (left, right) => left.startOffset - right.startOffset,
  );
}

function mergeDecryptedRows(current: DecryptedRow[], incoming: DecryptedRow[]): DecryptedRow[] {
  const byId = new Map(current.map((row) => [row.message.id, row]));
  for (const row of incoming) byId.set(row.message.id, row);
  return [...byId.values()].sort(
    (left, right) =>
      new Date(left.message.createdAt).getTime() - new Date(right.message.createdAt).getTime() ||
      left.message.id.localeCompare(right.message.id),
  );
}

export function DirectChatWorkspace({ conversationId }: { conversationId: string }): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const prepareDevice = usePrepareChatDevice();
  const workspace = useChatWorkspace();
  const syncHub = useChatSyncHub();
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const visibleError = error ?? recoveryError;
  const [conversation, setConversation] = useState<DirectConversationView | null>(null);
  const [rows, setRows] = useState<DecryptedRow[]>([]);
  const rowsRef = useRef<DecryptedRow[]>([]);
  const updateRows = useCallback(
    (next: SetStateAction<DecryptedRow[]>): void => {
      const current = rowsRef.current;
      const resolved =
        typeof next === "function"
          ? next(current)
          : next;
      rowsRef.current = resolved;
      setRows(resolved);
    },
    [],
  );
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [activeMention, setActiveMention] = useState<ActiveMentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestionsResponse | null>(null);
  const [mentionOptionIndex, setMentionOptionIndex] = useState(0);
  const [composerMentions, setComposerMentions] = useState<ComposerMention[]>([]);
  const [sending, setSending] = useState(false);
  const sendingLockRef = useRef(false);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [pendingRun, setPendingRun] = useState<OperatorRunView | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [muteStatus, setMuteStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const blockedByMe = conversation?.blockedByMe ?? false;
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportEvidence, setReportEvidence] =
    useState<DirectMessageReportEvidence | undefined>(undefined);

  const applyOperatorDelivery = useCallback(
    (
      delivery: OperatorInvocationDeliveryResult,
    ): void => {
      setError(null);
      setPendingRun(
        operatorRunNeedsPanel(delivery.run)
          ? delivery.run
          : null,
      );
      if (delivery.latest) {
        setConversation(delivery.latest);
      }
      if (delivery.rows.length > 0) {
        updateRows((current) =>
          mergeDecryptedRows(
            current,
            delivery.rows,
          ),
        );
        workspace.requestInboxRefresh();
      }
    },
    [updateRows, workspace],
  );

  useEffect(() => {
    let cancelled = false;
    let removeReconnectListeners: (() => void) | null = null;
    void (async () => {
      try {
        const currentUser = await fetchCurrentUser();
        if (!currentUser.emailVerified) {
          router.replace("/verify-email");
          return;
        }
        await syncAuthenticatedLocale(currentUser.locale);
        if (cancelled) return;
        const cookieLocale = readLocaleCookie();
        if (cookieLocale && cookieLocale !== locale) {
          router.refresh();
          return;
        }
        await prepareDevice();
        const device = await ensureLocalDevice();
        const detail = await fetchDirectConversation(conversationId);
        if (detail.blockedByMe) {
          await cancelPendingSendsForTrust({
            conversationId,
            senderDeviceId: device.deviceId,
            peerUserId: detail.peer.userId,
          });
        }
        const page = await fetchLatestDecryptedPage(
          detail,
          device.deviceId,
        );
        if (cancelled) return;
        setUserId(currentUser.id);
        setConversation(detail);
        try {
          const preference =
            await fetchSurfacePreference(detail.surfaceId);
          if (!cancelled) {
            setMuted(preference.muted);
            setMuteStatus("ready");
          }
        } catch (caught: unknown) {
          if (caught instanceof AuthRequiredError) {
            throw caught;
          }
          if (!cancelled) {
            setMuteStatus("error");
          }
        }
        const visibleRows = [...page.decrypted].reverse();
        updateRows(visibleRows);
        setNextCursor(page.nextCursor);
        setBoot("ready");

        // Pending outbox recovery must not gate the readable Direct detail.
        // Recover once after the shell is usable, then re-decrypt the latest
        // authoritative rows so a server-committed interrupted send can replace
        // its local undecryptable placeholder. Do not overwrite conversation
        // metadata or pagination here: sync/load-more may already have advanced
        // them while this background recovery was running.
        const recoverInitialState = async (
          retryAfterLeaseLoss: boolean,
        ): Promise<void> => {
          try {
            const result = await recoverPendingSends({
              conversationId,
              localDevice: device,
            });
            if (cancelled) return;
            if (result === "LOCAL_DEVICE_INACTIVE") {
              setRecoveryError("direct_chat_device_revoked");
              return;
            }
            if (result === "RECIPIENT_DEVICE_MISSING") {
              setRecoveryError(
                "direct_chat_recipient_device_missing",
              );
              return;
            }

            const recoveredDetail =
              await fetchDirectConversation(
                conversationId,
              );
            const recoveredPage =
              await fetchLatestDecryptedPage(
                recoveredDetail,
                device.deviceId,
              );
            if (cancelled) return;
            updateRows((current) =>
              mergeDecryptedRows(
                current,
                [...recoveredPage.decrypted].reverse(),
              ),
            );

            const deliveries =
              await recoverDirectOperatorInvocations({
                conversationId,
                actorUserId: currentUser.id,
                recoverPending: false,
              });
            if (cancelled) return;
            for (const delivery of deliveries) {
              applyOperatorDelivery(delivery);
            }
            workspace.requestInboxRefresh();
            // Clear only errors originating in recovery. A concurrent
            // user-triggered send/read failure must remain visible.
            setRecoveryError(null);
          } catch (recoveryError: unknown) {
            if (cancelled) return;
            if (
              recoveryError instanceof
              AuthRequiredError
            ) {
              router.replace("/sign-in");
              return;
            }
            if (
              recoveryError instanceof
              RatchetLockLostError
            ) {
              if (retryAfterLeaseLoss) {
                await recoverInitialState(false);
              }
              return;
            }
            setRecoveryError(
              recoveryError instanceof
                  DirectChatsApiError ||
                recoveryError instanceof
                  OperatorRequestError
                ? recoveryError.code
                : "internal_error",
            );
          }
        };
        void recoverInitialState(true);

        // An already-open conversation must recover after connectivity
        // returns (or a sleeping tab becomes foreground) without requiring
        // users to reload or exposing crypto maintenance controls.
        // Reuse the same serialized reconciliation as initial boot; bound
        // overlapping browser events to one in-flight attempt per surface.
        let reconnectFlight: Promise<void> | null = null;
        const retryOnReconnect = (): void => {
          if (cancelled || reconnectFlight || !navigator.onLine) {
            return;
          }
          reconnectFlight = (async () => {
            try {
              // Foreground/online events can be frequent. Avoid multiple
              // network fetches if there is nothing to reconcile locally.
              const pending = await loadPendingSends(
                conversationId,
                device.deviceId,
              );
              if (!cancelled && pending.length > 0) {
                await recoverInitialState(true);
              }
            } catch (caught: unknown) {
              if (cancelled) return;
              if (caught instanceof AuthRequiredError) {
                router.replace("/sign-in");
                return;
              }
              setRecoveryError("internal_error");
            }
          })().finally(() => {
            reconnectFlight = null;
          });
        };
        const retryWhenVisible = (): void => {
          if (document.visibilityState === "visible") {
            retryOnReconnect();
          }
        };
        window.addEventListener("online", retryOnReconnect);
        document.addEventListener("visibilitychange", retryWhenVisible);
        // Without a time-based wakeup a freshly cancelled send can remain
        // forever in an online tab that never reloads or loses focus.
        const gcInterval = window.setInterval(
          retryOnReconnect,
          TRUST_CANCELLED_GC_POLL_INTERVAL_MS,
        );
        removeReconnectListeners = () => {
          window.removeEventListener("online", retryOnReconnect);
          document.removeEventListener("visibilitychange", retryWhenVisible);
          window.clearInterval(gcInterval);
        };

        try {
          const read =
            detail.unreadCount > 0
              ? await markObservedDirectMessagesRead(
                  conversationId,
                  page.decrypted
                    .filter((row) => row.payload !== null)
                    .map((row) => row.message.id),
                  detail,
                )
              : detail;
          workspace.setInboxUnreadCount(
            read.surfaceId,
            read.unreadCount,
          );
          workspace.requestInboxRefresh();
        } catch (readError: unknown) {
          if (
            readError instanceof
            AuthRequiredError
          ) {
            router.replace("/sign-in");
          }
        }
      } catch (caught: unknown) {
        if (cancelled) return;
        if (caught instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setError(caught instanceof DirectChatsApiError ? caught.code : "internal_error");
        setBoot("failed");
      }
    })();
    return () => {
      cancelled = true;
      removeReconnectListeners?.();
    };
  }, [
    applyOperatorDelivery,
    attempt,
    conversationId,
    locale,
    prepareDevice,
    router,
    updateRows,
    workspace,
  ]);

  useEffect(() => {
    if (boot !== "ready") return;
    let cancelled = false;

    const syncLatest = async (
      requiredMessageIds: readonly string[] = [],
    ): Promise<void> => {
      const detail =
        await fetchDirectConversation(conversationId);
      const device = await ensureLocalDevice();
      const decrypted =
        await fetchDecryptedGap(
          detail,
          device.deviceId,
          rowsRef.current,
          requiredMessageIds,
        );
      if (cancelled) return;
      setConversation(detail);
      if (decrypted.length > 0) {
        updateRows((current) =>
          mergeDecryptedRows(
            current,
            decrypted,
          ),
        );
      }
      const read =
        detail.unreadCount > 0 &&
        decrypted.length > 0
          ? await markObservedDirectMessagesRead(
              conversationId,
              decrypted
                .filter((row) => row.payload !== null)
                .map((row) => row.message.id),
              detail,
            )
          : detail;
      workspace.setInboxUnreadCount(
        read.surfaceId,
        read.unreadCount,
      );
      workspace.requestInboxRefresh();
    };

    let refreshTail: Promise<void> =
      Promise.resolve();
    const requestRefresh = (
      requiredMessageIds: readonly string[] = [],
    ): Promise<void> => {
      const next = refreshTail
        .catch(() => undefined)
        .then(async () => {
          if (!cancelled) {
            await syncLatest(requiredMessageIds);
          }
        });
      refreshTail = next;
      return next;
    };

    const unsubscribe = syncHub.subscribe(
      async (deltas) => {
        if (cancelled) return;

        let refresh = false;
        const createdMessageIds = new Set<string>();
        const deletedMessageIds = new Set<string>();
        for (const delta of deltas) {
          if (
            delta.scope.kind !== "DIRECT_CHAT" ||
            delta.scope.id !== conversationId
          ) {
            continue;
          }
          refresh = true;
          if (
            delta.eventType ===
            "DIRECT_MESSAGE_CREATED"
          ) {
            createdMessageIds.add(
              delta.payload.messageId,
            );
          } else if (
            delta.eventType ===
            "DIRECT_MESSAGE_DELETED"
          ) {
            deletedMessageIds.add(
              delta.payload.messageId,
            );
            createdMessageIds.delete(
              delta.payload.messageId,
            );
          }
        }

        if (deletedMessageIds.size > 0) {
          updateRows((current) =>
            current.filter(
              (row) =>
                !deletedMessageIds.has(
                  row.message.id,
                ),
            ),
          );
        }
        if (refresh) {
          await requestRefresh(
            [...createdMessageIds],
          );
        }
      },
    );

    // Close the boot/subscription race: the workspace cursor may have
    // advanced while this detail was still loading its initial snapshot.
    void requestRefresh().catch((caught: unknown) => {
      if (cancelled) return;
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError(
        caught instanceof DirectChatsApiError
          ? caught.code
          : "internal_error",
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [boot, conversationId, router, syncHub, updateRows, workspace]);

  useEffect(() => {
    if (!activeMention) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchMentionSuggestions({ q: activeMention.query, directConversationId: conversationId })
        .then((suggestions) => {
          if (cancelled) return;
          setMentionSuggestions(suggestions);
          setMentionOptionIndex(0);
          const options = [...suggestions.people, ...suggestions.vimla, ...suggestions.ai];
          const exact = exactMentionOption(options, activeMention.query);
          if (exact) {
            const recognized = createComposerMention({
              localId: crypto.randomUUID(),
              handleId: exact.id,
              kind: exact.kind,
              canonicalHandle: exact.handle,
              startOffset: activeMention.start,
            });
            setComposerMentions((current) => upsertComposerMention(current, recognized));
          }
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          if (caught instanceof AuthRequiredError) {
            router.replace("/sign-in");
            return;
          }
          setMentionSuggestions(null);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeMention, conversationId, router]);

  const mentionOptions = useMemo(
    () => mentionSuggestions ? [...mentionSuggestions.people, ...mentionSuggestions.vimla, ...mentionSuggestions.ai] : [],
    [mentionSuggestions],
  );

  function closeMentionPicker(): void {
    setActiveMention(null);
    setMentionSuggestions(null);
    setMentionOptionIndex(0);
  }

  function handleDraftChange(value: string): void {
    const nextMention = findActiveMention(value);
    setComposerMentions((current) => {
      let reconciled = reconcileComposerMentions(draftRef.current, value, current);
      const queryToResolve = nextMention ?? activeMention;
      if (!queryToResolve) return reconciled;
      const exact = exactMentionOption(mentionOptions, queryToResolve.query);
      const token = `@${queryToResolve.query}`;
      if (!exact || value.slice(queryToResolve.start, queryToResolve.start + token.length) !== token) return reconciled;
      const recognized = createComposerMention({
        localId: crypto.randomUUID(),
        handleId: exact.id,
        kind: exact.kind,
        canonicalHandle: exact.handle,
        startOffset: queryToResolve.start,
      });
      reconciled = upsertComposerMention(reconciled, recognized);
      return reconciled;
    });
    draftRef.current = value;
    setDraft(value);
    setMentionSuggestions(null);
    setActiveMention(nextMention);
    setMentionOptionIndex(0);
  }

  function selectMention(option: MentionPickerOption): void {
    if (!activeMention) return;
    const nextValue = `${draftRef.current.slice(0, activeMention.start)}@${option.handle} ${draftRef.current.slice(activeMention.end)}`;
    const selected = createComposerMention({
      localId: crypto.randomUUID(),
      handleId: option.id,
      kind: option.kind,
      canonicalHandle: option.handle,
      startOffset: activeMention.start,
    });
    draftRef.current = nextValue;
    setDraft(nextValue);
    setComposerMentions((current) => upsertComposerMention(current, selected));
    closeMentionPicker();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!activeMention) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionPicker();
      return;
    }
    if (mentionOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionOptionIndex((index) => (index + 1) % mentionOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionOptionIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selected = mentionOptions[mentionOptionIndex];
      if (selected) selectMention(selected);
    }
  }

  async function onSend(): Promise<void> {
    const text = draftRef.current;
    if (sendingLockRef.current || sending || operatorBusy || text.trim().length === 0 || !conversation || !userId) return;
    closeMentionPicker();
    let resolvedComposerMentions = composerMentions;
    if (text.includes("@")) {
      try {
        const suggestions = await fetchMentionSuggestions({ q: "", directConversationId: conversationId });
        resolvedComposerMentions = resolveTypedComposerMentions(text, [
          ...suggestions.people,
          ...suggestions.vimla,
          ...suggestions.ai,
        ]);
      } catch (caught: unknown) {
        if (caught instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setError("internal_error");
        return;
      }
    }
    const mentions = toMessageMentionInputs(resolvedComposerMentions);
    const shouldInvokeVimla = CONSUMER_FEATURES.vimlaOperator && resolvedComposerMentions.some(
      (candidate) => candidate.kind === "SYSTEM_AGENT" && candidate.canonicalHandle === "vimla",
    );
    sendingLockRef.current = true;
    draftRef.current = "";
    setDraft("");
    setComposerMentions([]);
    try {
      if (shouldInvokeVimla) {
        await invokeOperator(text, mentions);
        return;
      }
      await postEncrypted("HUMAN", encodeDirectPlaintext({ type: "human", text }), mentions);
    } finally {
      sendingLockRef.current = false;
    }
  }

  async function postEncrypted(
    kind: DirectMessageKind,
    plaintext: string,
    mentions: MessageMentionInput[] = [],
    options: {
      clientMessageId?: string;
      operatorIntent?: StoredOperatorIntent;
    } = {},
  ): Promise<DirectMessageView | null> {
    if (!userId) return null;
    setSending(true);
    try {
      const result = await sendEncryptedDirectMessage({
        conversationId,
        userId,
        kind,
        plaintext,
        mentions,
        ...options,
      });
      setConversation(result.latest);
      updateRows((current) =>
        mergeDecryptedRows(current, [
          {
            message: result.message,
            payload: decodeDirectPlaintext(
              kind,
              plaintext,
            ),
            needsBootstrap: false,
          },
        ]),
      );
      if (kind === "HUMAN") {
        void recoverDirectOperatorInvocations({
          conversationId,
          actorUserId: userId,
        })
          .then((deliveries) => {
            for (const delivery of deliveries) {
              applyOperatorDelivery(delivery);
            }
          })
          .catch((caught: unknown) => {
            if (caught instanceof AuthRequiredError) {
              router.replace("/sign-in");
              return;
            }
            setError(
              caught instanceof OperatorRequestError ||
                caught instanceof DirectChatsApiError
                ? caught.code
                : "internal_error",
            );
          });
      }
      workspace.requestInboxRefresh();
      return result.message;
    } catch (caught: unknown) {
      setError(
        caught instanceof DirectChatsApiError
          ? caught.code
          : "internal_error",
      );
      return null;
    } finally {
      setSending(false);
    }
  }

  async function invokeOperator(
    text: string,
    mentions: MessageMentionInput[],
  ): Promise<void> {
    if (!conversation || !userId) return;
    setOperatorBusy(true);
    setError(null);
    try {
      const localPlaintexts =
        await loadConversationPlaintexts(
          conversation.id,
          256,
        );
      const preparedContext = prepareDirectChatContext({
        actorUserId: userId,
        privacy: conversation.privacy,
        query: text,
        messages: localPlaintexts,
      });
      const sourceClientMessageId =
        crypto.randomUUID();
      const operatorIntent: StoredOperatorIntent = {
        clientRequestId: crypto.randomUUID(),
        content: text,
        contextBundle: preparedContext.contextBundle,
      };
      const sourceMessage = await postEncrypted(
        "OPERATOR_INVOKE",
        encodeDirectPlaintext({
          type: "invoke",
          text,
          contextShared:
            preparedContext.contextBundle.messages.length >
            0,
          peerIncluded: preparedContext.peerIncluded,
        }),
        mentions,
        {
          clientMessageId: sourceClientMessageId,
          operatorIntent,
        },
      );

      if (sourceMessage) {
        const delivery =
          await resumeDirectOperatorInvocation(
            {
              pendingClientMessageId:
                sourceMessage.clientMessageId,
              conversationId: conversation.id,
              senderDeviceId:
                sourceMessage.senderDeviceId,
              interactionEpoch:
                sourceMessage.interactionEpoch,
              messageId: sourceMessage.id,
              messageCreatedAt:
                sourceMessage.createdAt,
              intent: operatorIntent,
            },
            userId,
          );
        if (delivery) {
          applyOperatorDelivery(delivery);
        }
        return;
      }

      const recovered =
        await recoverDirectOperatorInvocations({
          conversationId: conversation.id,
          actorUserId: userId,
          pendingClientMessageId:
            sourceClientMessageId,
        });
      for (const delivery of recovered) {
        applyOperatorDelivery(delivery);
      }
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError(
        caught instanceof OperatorRequestError ||
          caught instanceof DirectChatsApiError
          ? caught.code
          : "internal_error",
      );
    } finally {
      setOperatorBusy(false);
    }
  }

  async function retryMutePreference(): Promise<void> {
    if (!conversation || muteStatus === "loading") return;
    setMuteStatus("loading");
    try {
      const preference = await fetchSurfacePreference(
        conversation.surfaceId,
      );
      setMuted(preference.muted);
      setMuteStatus("ready");
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setMuteStatus("error");
    }
  }

  async function toggleMute(nextMuted: boolean): Promise<void> {
    if (!conversation || muteBusy || muteStatus !== "ready") return;
    const previousMuted = muted;
    setMuted(nextMuted);
    setMuteBusy(true);
    try {
      const preference = await updateSurfacePreference(
        conversation.surfaceId,
        { muted: nextMuted },
      );
      setMuted(preference.muted);
    } catch (caught: unknown) {
      setMuted(previousMuted);
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setMuteStatus("error");
    } finally {
      setMuteBusy(false);
    }
  }

  async function confirmBlock(): Promise<void> {
    if (!conversation || blockBusy) return;
    setBlockBusy(true);
    try {
      await blockUser(conversation.peer.handle);
      setConversation((current) =>
        current
          ? { ...current, blockedByMe: true }
          : current,
      );
      draftRef.current = "";
      setDraft("");
      setComposerMentions([]);
      setPendingRun(null);
      setBlockOpen(false);
      try {
        const device = await ensureLocalDevice();
        await cancelPendingSendsForTrust({
          conversationId: conversation.id,
          senderDeviceId: device.deviceId,
          peerUserId: conversation.peer.userId,
        });
      } catch {
        // The server block is authoritative. Keep the UI blocked even if
        // local outbox quarantine needs to be retried on the next chat load.
        setError("internal_error");
      }
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError("internal_error");
    } finally {
      setBlockBusy(false);
    }
  }

  function openGenericReport(): void {
    setReportEvidence(undefined);
    setReportOpen(true);
  }

  function openMessageReport(
    evidence: DirectMessageReportEvidence,
  ): void {
    setReportEvidence(evidence);
    setReportOpen(true);
  }

  async function onLoadOlder(): Promise<void> {
    if (!nextCursor || !conversation) return;
    setError(null);
    try {
      const device = await ensureLocalDevice();
      const page = await fetchDirectMessages(
        conversationId,
        device.deviceId,
        nextCursor,
      );
      const missingSenderDeviceIds = new Set(
        rows
          .filter((row) => row.needsBootstrap)
          .map((row) => row.message.senderDeviceId),
      );
      if (
        pageUnlocksHistoryBootstrap({
          missingSenderDeviceIds,
          messages: page.items,
        })
      ) {
        const decrypted = await decryptPage(
          conversation,
          [
            ...page.items,
            ...rows.map((row) => row.message),
          ],
        );
        updateRows(
          mergeDecryptedRows([], decrypted),
        );
      } else {
        const decrypted = await decryptPage(
          conversation,
          page.items,
        );
        updateRows((current) =>
          mergeDecryptedRows(current, decrypted),
        );
      }
      setNextCursor(page.nextCursor);
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError(
        caught instanceof DirectChatsApiError
          ? caught.code
          : "internal_error",
      );
    }
  }

  if (boot !== "ready" || !conversation) {
    return (
      <ChatDetailStatus
        failed={boot === "failed"}
        retry={() => {
          setBoot("loading");
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  return (
    <div className={styles.workspace} data-testid="direct-chat-shell">
      <ChatConversationHeader
        title={conversation.peer.name}
        subtitle={`@${conversation.peer.handle} · ${t("direct.e2eeSubtitle")}`}
        trailing={
          <div className={styles.headerActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={openGenericReport}
            >
              {t("trust.report")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={blockedByMe}
              onClick={() => setBlockOpen(true)}
            >
              {t("trust.block")}
            </Button>
          </div>
        }
      />
      <div className={styles.thread}>
        <div className={styles.privacy}>
          {muteStatus === "ready" ? (
            <Switch
              label={t("trust.mute")}
              checked={muted}
              disabled={muteBusy}
              onChange={(event) => {
                void toggleMute(event.currentTarget.checked);
              }}
            />
          ) : muteStatus === "error" ? (
            <div>
              <Alert variant="error">
                {t("trust.muteUnavailable")}
              </Alert>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void retryMutePreference()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <Text tone="caption">{t("common.loading")}</Text>
          )}
          <Switch
            label={t("direct.shareOwn")}
            checked={conversation.privacy.shareOwnHistoryWithVimla}
            onChange={(event) => {
              void updateDirectChatPrivacy(conversation.id, { shareOwnHistoryWithVimla: event.currentTarget.checked }).then(setConversation);
            }}
          />
          <Switch
            label={t("direct.includePeer")}
            checked={conversation.privacy.includePeerHistoryWhenInvoking}
            onChange={(event) => {
              void updateDirectChatPrivacy(conversation.id, { includePeerHistoryWhenInvoking: event.currentTarget.checked }).then(setConversation);
            }}
          />
          <Text tone="caption">
            {conversation.privacy.peerShareOwnHistoryWithVimla ? t("direct.peerAllowed") : t("direct.peerDenied")}
          </Text>
        </div>
        <div className={styles.messages}>
          {nextCursor ? (
            <Button
              variant="ghost"
              data-testid="direct-chat-load-older"
              onClick={() => void onLoadOlder()}
            >
              {t("direct.loadOlder")}
            </Button>
          ) : null}
          {visibleError ? (
            <Alert variant="error">
              {tx(t, apiErrorMessageKey(visibleError))}
            </Alert>
          ) : null}
          {rows.length === 0 ? <EmptyState title={t("direct.empty")} /> : null}
          {rows.map((row) => (
            <DirectRow
              key={row.message.id}
              row={row}
              self={row.message.senderUserId === userId}
              youLabel={t("chat.you")}
              peerName={conversation.peer.name}
              onReport={openMessageReport}
            />
          ))}
          {pendingRun ? (
            <OperatorRunPanel
              run={pendingRun}
              processing={operatorBusy}
              onConfirm={() => {
                if (!userId) return;
                setOperatorBusy(true);
                void (async () => {
                  const run =
                    await confirmDirectOperatorRun({
                      conversationId,
                      runId: pendingRun.id,
                    });
                  setPendingRun(
                    operatorRunNeedsPanel(run)
                      ? run
                      : null,
                  );
                  const recovered =
                    await recoverDirectOperatorInvocations({
                      conversationId,
                      actorUserId: userId,
                      runId: run.id,
                    });
                  for (const delivery of recovered) {
                    applyOperatorDelivery(delivery);
                  }
                })()
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof
                        OperatorRequestError
                        ? caught.code
                        : "internal_error",
                    ),
                  )
                  .finally(() =>
                    setOperatorBusy(false),
                  );
              }}
              onCancel={() => {
                if (!userId) return;
                setOperatorBusy(true);
                void (async () => {
                  const run =
                    await cancelDirectOperatorRun({
                      conversationId,
                      runId: pendingRun.id,
                    });
                  setPendingRun(
                    operatorRunNeedsPanel(run)
                      ? run
                      : null,
                  );
                  const recovered =
                    await recoverDirectOperatorInvocations({
                      conversationId,
                      actorUserId: userId,
                      runId: run.id,
                    });
                  for (const delivery of recovered) {
                    applyOperatorDelivery(delivery);
                  }
                })()
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof
                        OperatorRequestError
                        ? caught.code
                        : "internal_error",
                    ),
                  )
                  .finally(() =>
                    setOperatorBusy(false),
                  );
              }}
            />
          ) : null}
        </div>
      </div>
      <div style={{ position: "relative" }} onKeyDown={handleComposerKeyDown}>
        <MentionPicker
          open={activeMention !== null}
          ariaLabel="Mentions"
          emptyLabel="No matching mentions"
          activeId={mentionOptions[mentionOptionIndex]?.id ?? null}
          sections={[
            { id: "people", label: "People", options: mentionSuggestions?.people ?? [] },
            { id: "vimla", label: "Vimla", options: mentionSuggestions?.vimla ?? [] },
            { id: "ai", label: "AI", options: mentionSuggestions?.ai ?? [] },
          ]}
          onSelect={selectMention}
        />
        <ChatComposer
          variant="direct"
          value={draft}
          onChange={handleDraftChange}
          onSubmit={() => void onSend()}
          placeholder={t("direct.placeholder")}
          sendLabel={t("chat.send")}
          disabled={blockedByMe}
          sending={sending || operatorBusy}
          highlights={composerMentions}
        />
      </div>
      <ReportUserDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetHandle={conversation.peer.handle}
        evidence={reportEvidence}
      />
      <Dialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={t("trust.blockConfirmTitle", {
          handle: conversation.peer.handle,
        })}
        description={t("trust.blockConfirmDescription")}
        closeLabel={t("common.close")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={blockBusy} onClick={() => void confirmBlock()}>
              {t("trust.block")}
            </Button>
          </>
        }
      />
    </div>
  );
}

async function sendEncryptedDirectMessage(input: {
  conversationId: string;
  userId: string;
  kind: DirectMessageKind;
  plaintext: string;
  mentions?: MessageMentionInput[];
  clientMessageId?: string;
  operatorIntent?: StoredOperatorIntent;
  operatorOutput?: StoredOperatorOutputLink;
  recoverPending?: boolean;
  expectedInteractionEpoch?: number;
}): Promise<{
  message: DirectMessageView;
  latest: DirectConversationView;
}> {
  const device = await ensureLocalDevice();
  if (input.recoverPending !== false) {
    const recovery = await recoverPendingSends({
      conversationId: input.conversationId,
      localDevice: device,
    });
    if (recovery === "LOCAL_DEVICE_INACTIVE") {
      throw new DirectChatsApiError(
        "direct_chat_device_revoked",
      );
    }
    if (recovery === "RECIPIENT_DEVICE_MISSING") {
      throw new DirectChatsApiError(
        "direct_chat_recipient_device_missing",
      );
    }
  }
  const interaction = await prepareDirectMessageSend(
    input.conversationId,
    {
      senderDeviceId: device.deviceId,
    },
  );
  if (
    input.expectedInteractionEpoch !== undefined &&
    interaction.interactionEpoch !==
      input.expectedInteractionEpoch
  ) {
    throw new DirectChatsApiError(
      "direct_chat_interaction_stale",
      409,
    );
  }
  const latest = await fetchDirectConversation(
    input.conversationId,
  );
  const pending = await encryptForDevices({
    conversationId: latest.id,
    interactionEpoch: interaction.interactionEpoch,
    senderUserId: input.userId,
    peerUserId: latest.peer.userId,
    clientMessageId:
      input.clientMessageId ?? crypto.randomUUID(),
    localDevice: device,
    kind: input.kind,
    plaintext: input.plaintext,
    devices: latest.devices,
    mentions: input.mentions ?? [],
    ...(input.operatorIntent
      ? { operatorIntent: input.operatorIntent }
      : {}),
    ...(input.operatorOutput
      ? { operatorOutput: input.operatorOutput }
      : {}),
  });
  const message =
    await sendPendingDirectMessage(pending);
  await finalizePendingSend(pending, message);
  return { message, latest };
}

interface OperatorInvocationDeliveryResult {
  run: OperatorRunView;
  latest: DirectConversationView | null;
  rows: DecryptedRow[];
}

async function confirmDirectOperatorRun(input: {
  conversationId: string;
  runId: string;
}): Promise<OperatorRunView> {
  const device = await ensureLocalDevice();
  const attempt = async (): Promise<OperatorRunView> => {
    const fresh = await fetchOperatorRun(
      input.runId,
      { signal: operatorRequestSignal() },
    );
    if (fresh.status !== "AWAITING_CONFIRMATION") {
      return fresh;
    }
    const token = fresh.confirmationToken;
    if (!token) {
      throw new OperatorRequestError(
        "operator_confirmation_invalid",
      );
    }
    return confirmOperatorRun(
      input.runId,
      token,
      { signal: operatorRequestSignal() },
    );
  };

  return withPendingOperatorInvocationLock(
    {
      conversationId: input.conversationId,
      localDeviceId: device.deviceId,
    },
    async () => {
      try {
        return await attempt();
      } catch (caught: unknown) {
        if (
          !(caught instanceof OperatorRequestError) ||
          caught.code !==
            "operator_confirmation_invalid"
        ) {
          throw caught;
        }
        return attempt();
      }
    },
  );
}

async function cancelDirectOperatorRun(input: {
  conversationId: string;
  runId: string;
}): Promise<OperatorRunView> {
  const device = await ensureLocalDevice();
  return withPendingOperatorInvocationLock(
    {
      conversationId: input.conversationId,
      localDeviceId: device.deviceId,
    },
    () =>
      cancelOperatorRun(input.runId, {
        signal: operatorRequestSignal(),
      }),
  );
}

async function recoverDirectOperatorInvocations(input: {
  conversationId: string;
  actorUserId: string;
  pendingClientMessageId?: string;
  runId?: string;
  recoverPending?: boolean;
}): Promise<OperatorInvocationDeliveryResult[]> {
  const device = await ensureLocalDevice();
  if (input.recoverPending !== false) {
    const recovery = await recoverPendingSends({
      conversationId: input.conversationId,
      localDevice: device,
    });
    if (recovery === "LOCAL_DEVICE_INACTIVE") {
      throw new DirectChatsApiError(
        "direct_chat_device_revoked",
      );
    }
    if (recovery === "RECIPIENT_DEVICE_MISSING") {
      throw new DirectChatsApiError(
        "direct_chat_recipient_device_missing",
      );
    }
  }

  const invocations =
    await loadPendingOperatorInvocations({
      conversationId: input.conversationId,
      localDeviceId: device.deviceId,
    });
  const selected = invocations.filter(
    (invocation) =>
      (input.pendingClientMessageId === undefined ||
        invocation.pendingClientMessageId ===
          input.pendingClientMessageId) &&
      (input.runId === undefined ||
        invocation.intent.delivery?.runId ===
          input.runId),
  );
  const deliveries: OperatorInvocationDeliveryResult[] =
    [];
  for (const invocation of selected) {
    const delivery =
      await resumeDirectOperatorInvocation(
        invocation,
        input.actorUserId,
      );
    if (delivery) {
      deliveries.push(delivery);
    }
  }
  return deliveries;
}

async function ensurePendingOperatorInvocationCurrent(
  invocation: PendingOperatorInvocation,
): Promise<boolean> {
  try {
    const interaction = await prepareDirectMessageSend(
      invocation.conversationId,
      {
        senderDeviceId: invocation.senderDeviceId,
      },
    );
    if (
      interaction.interactionEpoch ===
      invocation.interactionEpoch
    ) {
      return true;
    }
  } catch (caught: unknown) {
    if (
      !(caught instanceof DirectChatsApiError) ||
      caught.code !== "forbidden"
    ) {
      throw caught;
    }
  }

  await discardPendingOperatorInvocation(
    invocation.pendingClientMessageId,
  );
  return false;
}

async function resumeDirectOperatorInvocation(
  invocation: PendingOperatorInvocation,
  actorUserId: string,
): Promise<OperatorInvocationDeliveryResult | null> {
  try {
    return await withPendingOperatorInvocationLock(
    {
      conversationId: invocation.conversationId,
      localDeviceId: invocation.senderDeviceId,
    },
    async () => {
      const pending =
        await loadPendingOperatorInvocations({
          conversationId: invocation.conversationId,
          localDeviceId: invocation.senderDeviceId,
        });
      let current = pending.find(
        (candidate) =>
          candidate.pendingClientMessageId ===
          invocation.pendingClientMessageId,
      );
      if (!current) {
        return null;
      }
      if (
        !(await ensurePendingOperatorInvocationCurrent(
          current,
        ))
      ) {
        return null;
      }

      if (current.intent.delivery) {
        const pendingRows = await loadPendingSends(
          current.conversationId,
          current.senderDeviceId,
        );
        const hasStagedOutput = pendingRows.some(
          (row) =>
            row.operatorOutput?.parentClientMessageId ===
            current!.pendingClientMessageId,
        );
        if (hasStagedOutput) {
          const localDevice = await ensureLocalDevice();
          await recoverPendingSends({
            conversationId: current.conversationId,
            localDevice,
          });
          const refreshed =
            await loadPendingOperatorInvocations({
              conversationId: current.conversationId,
              localDeviceId: current.senderDeviceId,
            });
          current = refreshed.find(
            (candidate) =>
              candidate.pendingClientMessageId ===
              invocation.pendingClientMessageId,
          );
          if (!current) {
            return null;
          }
        }
      }

      let run: OperatorRunView;
      if (current.intent.delivery) {
        run = await fetchOperatorRun(
          current.intent.delivery.runId,
          { signal: operatorRequestSignal() },
        );
      } else {
        const prepared = {
          contextBundle: current.intent.contextBundle,
          ownIncluded: false,
          peerIncluded: false,
        };
        const sourceBoundContext =
          boundDirectChatContextBefore(
            prepared,
            current.messageCreatedAt,
            actorUserId,
          );
        try {
          run = await createOperatorRun(
            {
              clientRequestId:
                current.intent.clientRequestId,
              content: current.intent.content,
              invocationScope: "DIRECT_CHAT",
              directConversationId:
                current.conversationId,
              directSourceMessageId:
                current.messageId,
              ...(sourceBoundContext.contextBundle.messages
                .length > 0
                ? {
                    contextBundle:
                      sourceBoundContext.contextBundle,
                  }
                : {}),
            },
            { signal: operatorRequestSignal() },
          );
        } catch (caught: unknown) {
          if (
            caught instanceof OperatorRequestError &&
            (caught.code === "conflict" ||
              caught.code ===
                "direct_chat_context_revoked") &&
            !(await ensurePendingOperatorInvocationCurrent(
              current,
            ))
          ) {
            return null;
          }
          throw caught;
        }
      }

      if (
        !(await ensurePendingOperatorInvocationCurrent(
          current,
        ))
      ) {
        return null;
      }
      if (isTransientOperatorRun(run)) {
        throw new Error(
          "Direct Chat operator run is still in progress",
        );
      }

      const stagedIntent =
        await stagePendingOperatorInvocationDelivery({
          pendingClientMessageId:
            current.pendingClientMessageId,
          runId: run.id,
          runStatus: run.status,
          runUpdatedAt: run.updatedAt,
          outputs: operatorDeliveryOutputs(run),
        });

      if (
        stagedIntent.delivery &&
        (stagedIntent.delivery.runUpdatedAt !==
          run.updatedAt ||
          stagedIntent.delivery.runStatus !== run.status)
      ) {
        run = await fetchOperatorRun(
          stagedIntent.delivery.runId,
          { signal: operatorRequestSignal() },
        );
        if (isTransientOperatorRun(run)) {
          throw new Error(
            "Direct Chat operator run is still in progress",
          );
        }
        await stagePendingOperatorInvocationDelivery({
          pendingClientMessageId:
            current.pendingClientMessageId,
          runId: run.id,
          runStatus: run.status,
          runUpdatedAt: run.updatedAt,
          outputs: operatorDeliveryOutputs(run),
        });
      }

      const staged =
        await loadPendingOperatorInvocations({
          conversationId: invocation.conversationId,
          localDeviceId: invocation.senderDeviceId,
        });
      current = staged.find(
        (candidate) =>
          candidate.pendingClientMessageId ===
          invocation.pendingClientMessageId,
      );
      if (!current?.intent.delivery) {
        return null;
      }

      const delivery = current.intent.delivery;
      let latest: DirectConversationView | null = null;
      const rows: DecryptedRow[] = [];
      for (const output of delivery.outputs) {
        if (output.delivered) continue;
        const result = await sendEncryptedDirectMessage({
          conversationId: current.conversationId,
          userId: actorUserId,
          kind: output.kind,
          plaintext: output.plaintext,
          clientMessageId: output.clientMessageId,
          operatorOutput: {
            parentClientMessageId:
              current.pendingClientMessageId,
            outputId: output.id,
          },
          recoverPending: false,
          expectedInteractionEpoch:
            current.interactionEpoch,
        });
        latest = result.latest;
        rows.push({
          message: result.message,
          payload: decodeDirectPlaintext(
            output.kind,
            output.plaintext,
          ),
          needsBootstrap: false,
        });
      }

      const afterDelivery =
        await loadPendingOperatorInvocations({
          conversationId: current.conversationId,
          localDeviceId: current.senderDeviceId,
        });
      const remaining = afterDelivery.find(
        (candidate) =>
          candidate.pendingClientMessageId ===
          current!.pendingClientMessageId,
      );
      if (
        remaining?.intent.delivery &&
        remaining.intent.delivery.outputs.every(
          (output) => output.delivered,
        )
      ) {
        await finalizePendingOperatorInvocation(
          current.pendingClientMessageId,
        );
      }

      return { run, latest, rows };
    },
    );
  } catch (caught: unknown) {
    if (
      caught instanceof
        PendingOperatorInvocationGoneError ||
      caught instanceof RatchetLockLostError
    ) {
      return null;
    }
    if (
      caught instanceof DirectChatsApiError &&
      (caught.code === "forbidden" ||
        caught.code ===
          "direct_chat_interaction_stale")
    ) {
      await discardPendingOperatorInvocation(
        invocation.pendingClientMessageId,
      );
      return null;
    }
    throw caught;
  }
}

function operatorDeliveryOutputs(
  run: OperatorRunView,
): StoredOperatorOutputDraft[] {
  const outputs: StoredOperatorOutputDraft[] = [];
  if (run.publicMessage || run.clarificationQuestion) {
    outputs.push({
      id: `response:${run.id}:${run.updatedAt}`,
      kind: "OPERATOR_RESPONSE",
      plaintext: encodeDirectPlaintext({
        type: "response",
        text: run.publicMessage ?? "",
        runId: run.id,
        clarificationQuestion:
          run.clarificationQuestion,
      }),
    });
  }
  run.actions.forEach((action, index) => {
    outputs.push({
      id: `action:${run.id}:${run.updatedAt}:${index}`,
      kind: "OPERATOR_ACTION",
      plaintext: encodeDirectPlaintext({
        type: "action",
        title: action.title,
        detail: action.detail,
        status: action.status,
      }),
    });
  });
  return outputs;
}

function isTransientOperatorRun(
  run: OperatorRunView,
): boolean {
  return (
    run.status === "CREATED" ||
    run.status === "PLANNING" ||
    run.status === "EXECUTING"
  );
}

function operatorRequestSignal(): AbortSignal {
  return AbortSignal.timeout(
    OPERATOR_RECOVERY_REQUEST_TIMEOUT_MS,
  );
}

async function fetchDecryptedGap(
  detail: DirectConversationView,
  deviceId: string,
  currentRows: readonly DecryptedRow[],
  requiredMessageIds: readonly string[] = [],
): Promise<DecryptedRow[]> {
  if (currentRows.length === 0) {
    const all: DirectMessageView[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await fetchDirectMessages(
        detail.id,
        deviceId,
        cursor,
      );
      all.push(...page.items);
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    return (
      await decryptPage(detail, all)
    ).reverse();
  }

  const knownIds = new Set(
    currentRows.map((row) => row.message.id),
  );
  const requiredUnknownIds = new Set(
    requiredMessageIds.filter(
      (messageId) => !knownIds.has(messageId),
    ),
  );
  const targetDriven = requiredMessageIds.length > 0;
  if (targetDriven && requiredUnknownIds.size === 0) {
    return [];
  }

  const incoming: DirectMessageView[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchDirectMessages(
      detail.id,
      deviceId,
      cursor,
    );

    if (targetDriven) {
      let oldestRequiredIndex = -1;
      page.items.forEach((message, index) => {
        if (requiredUnknownIds.delete(message.id)) {
          oldestRequiredIndex = index;
        }
      });

      const upperBound =
        requiredUnknownIds.size === 0 &&
        oldestRequiredIndex >= 0
          ? oldestRequiredIndex + 1
          : page.items.length;
      incoming.push(
        ...page.items
          .slice(0, upperBound)
          .filter(
            (message) => !knownIds.has(message.id),
          ),
      );
      if (requiredUnknownIds.size === 0) {
        break;
      }
    } else {
      let oldestKnownIndex = -1;
      page.items.forEach((message, index) => {
        if (knownIds.has(message.id)) {
          oldestKnownIndex = index;
        }
      });
      if (oldestKnownIndex >= 0) {
        incoming.push(
          ...page.items
            .slice(0, oldestKnownIndex)
            .filter(
              (message) => !knownIds.has(message.id),
            ),
        );
        break;
      }
      incoming.push(
        ...page.items.filter(
          (message) => !knownIds.has(message.id),
        ),
      );
    }

    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  if (incoming.length === 0) {
    return [];
  }
  return (
    await decryptPage(detail, incoming)
  ).reverse();
}

async function fetchLatestDecryptedPage(
  detail: DirectConversationView,
  deviceId: string,
): Promise<{
  decrypted: DecryptedRow[];
  nextCursor: string | null;
}> {
  const first = await fetchDirectMessages(
    detail.id,
    deviceId,
  );
  const initial = await decryptPage(detail, first.items);
  const missingSenders = new Set(
    initial
      .filter((row) => row.needsBootstrap)
      .map((row) => row.message.senderDeviceId),
  );
  if (missingSenders.size === 0 || !first.nextCursor) {
    return {
      decrypted: initial,
      nextCursor: first.nextCursor,
    };
  }

  const localDeviceCreatedAt = detail.devices.find(
    (device) => device.id === deviceId,
  )?.createdAt;
  const localDeviceCreatedAtMs = localDeviceCreatedAt
    ? Date.parse(localDeviceCreatedAt)
    : Number.NEGATIVE_INFINITY;
  const allItems = [...first.items];
  let cursor: string | null = first.nextCursor;
  let backfillPages = 0;

  while (
    shouldContinueDeepHistoryBootstrap({
      cursor,
      missingSenderCount: missingSenders.size,
      backfillPages,
    })
  ) {
    const pageCursor = cursor;
    if (!pageCursor) break;
    backfillPages += 1;
    const older = await fetchDirectMessages(
      detail.id,
      deviceId,
      pageCursor,
    );
    allItems.push(...older.items);
    for (const message of older.items) {
      if (
        message.envelope?.x3dhInit &&
        missingSenders.has(message.senderDeviceId)
      ) {
        missingSenders.delete(message.senderDeviceId);
      }
    }
    cursor = older.nextCursor;

    const oldest = older.items.at(-1);
    if (
      oldest &&
      Number.isFinite(localDeviceCreatedAtMs) &&
      Date.parse(oldest.createdAt) < localDeviceCreatedAtMs &&
      missingSenders.size > 0
    ) {
      break;
    }
  }

  const decryptedAll = await decryptPage(
    detail,
    allItems,
  );
  const firstIds = new Set(
    first.items.map((message) => message.id),
  );
  return {
    decrypted: decryptedAll.filter((row) =>
      firstIds.has(row.message.id),
    ),
    nextCursor: first.nextCursor,
  };
}

async function decryptPage(detail: DirectConversationView, items: DirectMessageView[]): Promise<DecryptedRow[]> {
  const identityByDevice = new Map(
    detail.devices.map((device) => [
      device.id,
      device.identityEd25519Public,
    ]),
  );
  const byId = new Map<string, DecryptedRow>();
  const chronological = [...items].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime() ||
      left.id.localeCompare(right.id),
  );
  for (const message of chronological) {
    const initIdentity =
      message.envelope?.x3dhInit
        ?.identityEd25519Public;
    if (initIdentity) {
      identityByDevice.set(
        message.senderDeviceId,
        initIdentity,
      );
    }
    const senderPublic =
      identityByDevice.get(message.senderDeviceId);
    const result = await decryptMessageWithStatus({
      conversationId: detail.id,
      message,
      ...(senderPublic
        ? { senderIdentityEd25519Public: senderPublic }
        : {}),
    });
    byId.set(message.id, {
      message,
      payload: result.payload,
      needsBootstrap: result.needsBootstrap,
    });
  }
  return items.map(
    (message) =>
      byId.get(message.id) ?? {
        message,
        payload: null,
        needsBootstrap: false,
      },
  );
}

function operatorRunNeedsPanel(
  run: OperatorRunView,
): boolean {
  return run.status === "AWAITING_CONFIRMATION";
}

function directActionStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
): string {
  if (status === "pending_confirmation") {
    return tx(t, "operator.needsConfirmation");
  }
  if (status === "error") {
    return tx(t, "operator.failed");
  }
  if (status === "skipped") {
    return tx(t, "operator.skipped");
  }
  return tx(t, "operator.completed");
}

function DirectRow({
  row,
  self,
  youLabel,
  peerName,
  onReport,
}: {
  row: DecryptedRow;
  self: boolean;
  youLabel: string;
  peerName: string;
  onReport: (evidence: DirectMessageReportEvidence) => void;
}): ReactElement {
  const t = useTranslations();
  const label = self ? youLabel : peerName;
  if (!row.payload) {
    return <article className={styles.undecryptable} data-testid="direct-message-undecryptable"><Text tone="caption">{t("direct.undecryptable")}</Text></article>;
  }
  if (row.payload.type === "human") {
    return self ? (
      <UserMessage label={label}><span data-testid="direct-message-human">{row.payload.text}</span></UserMessage>
    ) : (
      <AssistantMessage label={label}>
        <span data-testid="direct-message-human">{row.payload.text}</span>
        {row.message.kind === "HUMAN" ? (
          <>
            <br />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onReport({
                  kind: "DIRECT_MESSAGE",
                  conversationId: row.message.conversationId,
                  messageId: row.message.id,
                  disclosedText: row.payload!.type === "human"
                    ? row.payload!.text
                    : "",
                })
              }
            >
              {t("trust.reportMessage")}
            </Button>
          </>
        ) : null}
      </AssistantMessage>
    );
  }
  if (row.payload.type === "invoke") {
    return (
      <Card data-testid="direct-message-invoke">
        <div className={styles.kind}>
          <Badge variant="accent">{t("direct.invoke")}</Badge>
          {row.payload.contextShared ? <Badge>{t("direct.contextShared")}</Badge> : <Badge>{t("direct.contextDenied")}</Badge>}
        </div>
        <Text>{row.payload.text}</Text>
        {!self ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onReport({
                kind: "DIRECT_MESSAGE",
                conversationId: row.message.conversationId,
                messageId: row.message.id,
                disclosedText: row.payload!.type === "invoke"
                  ? row.payload!.text
                  : "",
              })
            }
          >
            {t("trust.reportMessage")}
          </Button>
        ) : null}
      </Card>
    );
  }
  if (row.payload.type === "response") {
    return (
      <AssistantMessage label={t("chat.assistant")}>
        {row.payload.text ? (
          <span data-testid="direct-message-response">
            {row.payload.text}
          </span>
        ) : null}
        {row.payload.clarificationQuestion ? (
          <>
            <br />
            <span data-testid="direct-message-clarification">
              {row.payload.clarificationQuestion}
            </span>
          </>
        ) : null}
      </AssistantMessage>
    );
  }
  return (
    <Card data-testid="direct-message-action">
      <div className={styles.kind}>
        <Badge variant="accent">{t("direct.action")}</Badge>
        <Badge>
          {directActionStatusLabel(
            t,
            row.payload.status,
          )}
        </Badge>
      </div>
      <Text>{row.payload.title}</Text>
      {row.payload.detail ? <Text tone="secondary">{row.payload.detail}</Text> : null}
    </Card>
  );
}
