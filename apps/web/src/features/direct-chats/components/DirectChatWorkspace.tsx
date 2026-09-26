"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type {
  DirectConversationView,
  DirectMessageKind,
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
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../shared/i18n/persist-locale";
import {
  DirectChatsApiError,
  fetchDirectConversation,
  fetchDirectMessages,
  markDirectChatRead,
  sendDirectMessage,
  updateDirectChatPrivacy,
} from "../services/api";
import {
  PendingOperatorInvocationGoneError,
  loadConversationPlaintexts,
  loadPendingSends,
  type StoredOperatorIntent,
  type StoredOperatorOutputDraft,
  type StoredOperatorOutputLink,
} from "../services/crypto-store";
import {
  boundDirectChatContextBefore,
  prepareDirectChatContext,
} from "../services/context";
import {
  pageUnlocksHistoryBootstrap,
  shouldContinueDeepHistoryBootstrap,
} from "../services/history-bootstrap";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "../services/payload";
import { subscribeDirectChatEvents } from "../services/realtime";
import { RatchetLockLostError } from "../services/ratchet-coordination";
import {
  decryptMessageWithStatus,
  encryptForDevices,
  ensureLocalDevice,
  finalizePendingOperatorInvocation,
  finalizePendingSend,
  loadPendingOperatorInvocations,
  recoverPendingSends,
  stagePendingOperatorInvocationDelivery,
  withPendingOperatorInvocationLock,
  type PendingOperatorInvocation,
} from "../services/session";
import { useChatWorkspace, usePrepareChatDevice } from "../../chat/components/ChatWorkspace/ChatWorkspaceProvider";
import { ChatConversationHeader } from "../../chat/components/ChatWorkspace/ChatConversationHeader";
import { ChatDetailStatus } from "../../chat/components/ChatWorkspace/ChatDetailStatus";
import styles from "./DirectChatWorkspace.module.scss";

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
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<DirectConversationView | null>(null);
  const [rows, setRows] = useState<DecryptedRow[]>([]);
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

  useEffect(() => {
    let cancelled = false;
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
        await recoverPendingSends({
          conversationId,
          localDevice: device,
        });
        const detail = await fetchDirectConversation(conversationId);
        const page = await fetchLatestDecryptedPage(
          detail,
          device.deviceId,
        );
        if (cancelled) return;
        setUserId(currentUser.id);
        setConversation(detail);
        setRows(page.decrypted.reverse());
        setNextCursor(page.nextCursor);
        setBoot("ready");
        const read =
          detail.unreadCount > 0
            ? await markDirectChatRead(conversationId)
            : detail;
        if (!cancelled) {
          workspace.updateDirectConversation(read);
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
    };
  }, [attempt, conversationId, locale, prepareDevice, router, workspace]);

  useEffect(() => {
    if (boot !== "ready") return;
    let cancelled = false;
    let syncing = false;
    let queued = false;

    const syncLatest = async (): Promise<void> => {
      if (syncing) {
        queued = true;
        return;
      }
      syncing = true;
      do {
        queued = false;
        try {
          const detail = await fetchDirectConversation(conversationId);
          const device = await ensureLocalDevice();
          const page = await fetchLatestDecryptedPage(
            detail,
            device.deviceId,
          );
          if (cancelled) break;
          setConversation(detail);
          setRows((current) =>
            mergeDecryptedRows(
              current,
              page.decrypted.reverse(),
            ),
          );
          const read =
            detail.unreadCount > 0
              ? await markDirectChatRead(conversationId)
              : detail;
          if (!cancelled) {
            workspace.updateDirectConversation(read);
          }
        } catch (caught: unknown) {
          if (cancelled) break;
          if (caught instanceof AuthRequiredError) {
            router.replace("/sign-in");
            break;
          }
          setError(caught instanceof DirectChatsApiError ? caught.code : "internal_error");
        }
      } while (queued && !cancelled);
      syncing = false;
    };

    const unsubscribe = subscribeDirectChatEvents({
      onOpen: () => void syncLatest(),
      onMessage: (event) => {
        if (event.conversationId === conversationId) void syncLatest();
      },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [boot, conversationId, router, workspace]);

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
      setRows((current) =>
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
          .catch(() => undefined);
      }
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

  function applyOperatorDelivery(
    delivery: OperatorInvocationDeliveryResult,
  ): void {
    setError(null);
    setPendingRun(delivery.run);
    if (delivery.latest) {
      setConversation(delivery.latest);
    }
    if (delivery.rows.length > 0) {
      setRows((current) =>
        mergeDecryptedRows(
          current,
          delivery.rows,
        ),
      );
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
        ).catch(() => []);
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

  useEffect(() => {
    if (boot !== "ready" || !userId) return;
    let cancelled = false;
    void recoverDirectOperatorInvocations({
      conversationId,
      actorUserId: userId,
    })
      .then((deliveries) => {
        if (cancelled) return;
        for (const delivery of deliveries) {
          setPendingRun(delivery.run);
          if (delivery.latest) {
            setConversation(delivery.latest);
          }
          if (delivery.rows.length > 0) {
            setRows((current) =>
              mergeDecryptedRows(
                current,
                delivery.rows,
              ),
            );
          }
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [boot, conversationId, router, userId]);

  async function onLoadOlder(): Promise<void> {
    if (!nextCursor || !conversation) return;
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
      setRows(
        mergeDecryptedRows([], decrypted),
      );
    } else {
      const decrypted = await decryptPage(
        conversation,
        page.items,
      );
      setRows((current) =>
        mergeDecryptedRows(current, decrypted),
      );
    }
    setNextCursor(page.nextCursor);
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
      <ChatConversationHeader title={conversation.peer.name} subtitle={t("direct.e2eeSubtitle")} />
      <div className={styles.thread}>
        <div className={styles.privacy}>
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
          {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
          {rows.length === 0 ? <EmptyState title={t("direct.empty")} /> : null}
          {rows.map((row) => (
            <DirectRow key={row.message.id} row={row} self={row.message.senderUserId === userId} youLabel={t("chat.you")} peerName={conversation.peer.name} />
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
                  setPendingRun(run);
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
                    await cancelOperatorRun(
                      pendingRun.id,
                    );
                  setPendingRun(run);
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
          sending={sending || operatorBusy}
          highlights={composerMentions}
        />
      </div>
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
  const latest = await fetchDirectConversation(
    input.conversationId,
  );
  const pending = await encryptForDevices({
    conversationId: latest.id,
    senderUserId: input.userId,
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
  const message = await sendDirectMessage(latest.id, {
    clientMessageId: pending.clientMessageId,
    senderDeviceId: pending.senderDeviceId,
    kind: pending.kind,
    envelopes: pending.envelopes,
    mentions: pending.mentions,
  });
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
    const fresh = await fetchOperatorRun(input.runId);
    const token = fresh.confirmationToken;
    if (!token) {
      throw new OperatorRequestError(
        "operator_confirmation_invalid",
      );
    }
    return confirmOperatorRun(input.runId, token);
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

async function recoverDirectOperatorInvocations(input: {
  conversationId: string;
  actorUserId: string;
  pendingClientMessageId?: string;
  runId?: string;
}): Promise<OperatorInvocationDeliveryResult[]> {
  const device = await ensureLocalDevice();
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
        run = await withOperatorRecoveryTimeout(
          fetchOperatorRun(
            current.intent.delivery.runId,
          ),
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
        run = await withOperatorRecoveryTimeout(
          createOperatorRun({
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
          }),
        );
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
        run = await withOperatorRecoveryTimeout(
          fetchOperatorRun(
            stagedIntent.delivery.runId,
          ),
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
    throw caught;
  }
}

function operatorDeliveryOutputs(
  run: OperatorRunView,
): StoredOperatorOutputDraft[] {
  const outputs: StoredOperatorOutputDraft[] = [];
  if (run.publicMessage) {
    outputs.push({
      id: JSON.stringify([
        "response",
        run.publicMessage,
      ]),
      kind: "OPERATOR_RESPONSE",
      plaintext: encodeDirectPlaintext({
        type: "response",
        text: run.publicMessage,
        runId: run.id,
      }),
    });
  }
  run.actions.forEach((action, index) => {
    outputs.push({
      id: JSON.stringify([
        "action",
        index,
        action.kind,
        action.operation,
        action.title,
        action.detail,
        action.status,
      ]),
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

async function withOperatorRecoveryTimeout<T>(
  operation: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Direct Chat operator recovery timed out",
              ),
            ),
          OPERATOR_RECOVERY_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
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

function DirectRow({ row, self, youLabel, peerName }: { row: DecryptedRow; self: boolean; youLabel: string; peerName: string }): ReactElement {
  const t = useTranslations();
  const label = self ? youLabel : peerName;
  if (!row.payload) {
    return <article className={styles.undecryptable} data-testid="direct-message-undecryptable"><Text tone="caption">{t("direct.undecryptable")}</Text></article>;
  }
  if (row.payload.type === "human") {
    return self ? (
      <UserMessage label={label}><span data-testid="direct-message-human">{row.payload.text}</span></UserMessage>
    ) : (
      <AssistantMessage label={label}><span data-testid="direct-message-human">{row.payload.text}</span></AssistantMessage>
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
      </Card>
    );
  }
  if (row.payload.type === "response") {
    return <AssistantMessage label={t("chat.assistant")}><span data-testid="direct-message-response">{row.payload.text}</span></AssistantMessage>;
  }
  return (
    <Card data-testid="direct-message-action">
      <Badge variant="accent">{t("direct.action")}</Badge>
      <Text>{row.payload.title}</Text>
      {row.payload.detail ? <Text tone="secondary">{row.payload.detail}</Text> : null}
    </Card>
  );
}
