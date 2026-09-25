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
  loadConversationPlaintexts,
  savePlaintext,
} from "../services/crypto-store";
import {
  boundDirectChatContextBefore,
  prepareDirectChatContext,
} from "../services/context";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "../services/payload";
import { subscribeDirectChatEvents } from "../services/realtime";
import {
  acknowledgeSentRatchets,
  decryptMessage,
  encryptForDevices,
  ensureLocalDevice,
} from "../services/session";
import { useChatWorkspace, usePrepareChatDevice } from "../../chat/components/ChatWorkspace/ChatWorkspaceProvider";
import { ChatConversationHeader } from "../../chat/components/ChatWorkspace/ChatConversationHeader";
import { ChatDetailStatus } from "../../chat/components/ChatWorkspace/ChatDetailStatus";
import styles from "./DirectChatWorkspace.module.scss";

interface DecryptedRow {
  message: DirectMessageView;
  payload: DirectPlaintextPayload | null;
}

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
        const detail = await fetchDirectConversation(conversationId);
        const device = await ensureLocalDevice();
        const page = await fetchDirectMessages(conversationId, device.deviceId);
        const decrypted = await decryptPage(detail, page.items);
        if (cancelled) return;
        setUserId(currentUser.id);
        setConversation(detail);
        setRows(decrypted.reverse());
        setNextCursor(page.nextCursor);
        setBoot("ready");
        const read = await markDirectChatRead(conversationId);
        if (!cancelled) workspace.updateDirectConversation(read);
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
          const page = await fetchDirectMessages(conversationId, device.deviceId);
          const decrypted = await decryptPage(detail, page.items);
          if (cancelled) break;
          setConversation(detail);
          setRows((current) => mergeDecryptedRows(current, decrypted.reverse()));
          const read = await markDirectChatRead(conversationId);
          if (!cancelled) workspace.updateDirectConversation(read);
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

  async function reloadConversation(): Promise<DirectConversationView> {
    const detail = await fetchDirectConversation(conversationId);
    setConversation(detail);
    return detail;
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

  async function invokeOperator(text: string, mentions: MessageMentionInput[]): Promise<void> {
    if (!conversation || !userId) return;
    setOperatorBusy(true);
    setError(null);
    try {
      const localPlaintexts = await loadConversationPlaintexts(
        conversation.id,
        256,
      ).catch(() => []);
      const preparedContext = prepareDirectChatContext({
        actorUserId: userId,
        privacy: conversation.privacy,
        query: text,
        messages: localPlaintexts,
      });
      const sourceMessage = await postEncrypted(
        "OPERATOR_INVOKE",
        encodeDirectPlaintext({
          type: "invoke",
          text,
          contextShared: preparedContext.contextBundle.messages.length > 0,
          peerIncluded: preparedContext.peerIncluded,
        }),
        mentions,
      );
      if (!sourceMessage) return;
      const sourceBoundContext = boundDirectChatContextBefore(
        preparedContext,
        sourceMessage.createdAt,
        userId,
      );
      const run = await createOperatorRun({
        clientRequestId: crypto.randomUUID(),
        content: text,
        invocationScope: "DIRECT_CHAT",
        directConversationId: conversation.id,
        directSourceMessageId: sourceMessage.id,
        ...(sourceBoundContext.contextBundle.messages.length > 0
          ? { contextBundle: sourceBoundContext.contextBundle }
          : {}),
      });
      setPendingRun(run);
      if (run.publicMessage) {
        await postEncrypted("OPERATOR_RESPONSE", encodeDirectPlaintext({ type: "response", text: run.publicMessage, runId: run.id }));
      }
      const action = run.actions[0];
      if (action) {
        await postEncrypted(
          "OPERATOR_ACTION",
          encodeDirectPlaintext({ type: "action", title: action.title, detail: action.detail, status: action.status }),
        );
      }
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError(caught instanceof OperatorRequestError || caught instanceof DirectChatsApiError ? caught.code : "internal_error");
    } finally {
      setOperatorBusy(false);
    }
  }

  async function postEncrypted(
    kind: DirectMessageKind,
    plaintext: string,
    mentions: MessageMentionInput[] = [],
  ): Promise<DirectMessageView | null> {
    if (!conversation || !userId) return null;
    setSending(true);
    try {
      const latest = await reloadConversation();
      const device = await ensureLocalDevice();
      const envelopes = await encryptForDevices({
        conversationId: latest.id,
        senderUserId: userId,
        kind,
        plaintext,
        devices: latest.devices,
        mentions,
      });
      const created = await sendDirectMessage(latest.id, {
        clientMessageId: crypto.randomUUID(),
        senderDeviceId: device.deviceId,
        kind,
        envelopes,
        mentions,
      });
      await savePlaintext({
        conversationId: latest.id,
        messageId: created.id,
        text: plaintext,
        kind,
        senderUserId: userId,
        createdAt: created.createdAt,
      });
      void acknowledgeSentRatchets({
        conversationId: latest.id,
        localDeviceId: device.deviceId,
        envelopes,
      });
      setRows((current) => mergeDecryptedRows(current, [
        { message: created, payload: decodeDirectPlaintext(kind, plaintext) },
      ]));
      return created;
    } catch (caught: unknown) {
      setError(caught instanceof DirectChatsApiError ? caught.code : "internal_error");
      return null;
    } finally {
      setSending(false);
    }
  }

  async function onLoadOlder(): Promise<void> {
    if (!nextCursor || !conversation) return;
    const device = await ensureLocalDevice();
    const page = await fetchDirectMessages(conversationId, device.deviceId, nextCursor);
    const decrypted = await decryptPage(conversation, page.items);
    setRows((current) => mergeDecryptedRows(current, decrypted.reverse()));
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
          {nextCursor ? <Button variant="ghost" onClick={() => void onLoadOlder()}>{t("direct.loadOlder")}</Button> : null}
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
                setOperatorBusy(true);
                void (async () => {
                  const token = pendingRun.confirmationToken ?? (await fetchOperatorRun(pendingRun.id)).confirmationToken;
                  if (!token) throw new OperatorRequestError("operator_confirmation_invalid");
                  const run = await confirmOperatorRun(pendingRun.id, token);
                  setPendingRun(run);
                  if (run.publicMessage) {
                    await postEncrypted("OPERATOR_RESPONSE", encodeDirectPlaintext({ type: "response", text: run.publicMessage, runId: run.id }));
                  }
                })()
                  .catch((caught: unknown) => setError(caught instanceof OperatorRequestError ? caught.code : "internal_error"))
                  .finally(() => setOperatorBusy(false));
              }}
              onCancel={() => { void cancelOperatorRun(pendingRun.id).then(setPendingRun); }}
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

async function decryptPage(detail: DirectConversationView, items: DirectMessageView[]): Promise<DecryptedRow[]> {
  const map = new Map(detail.devices.map((device) => [device.id, device.identityEd25519Public]));
  const byId = new Map<string, DecryptedRow>();
  const chronological = [...items].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime() ||
      left.id.localeCompare(right.id),
  );
  for (const message of chronological) {
    const senderPublic = map.get(message.senderDeviceId) ?? message.envelope?.x3dhInit?.identityEd25519Public ?? "";
    const payload = senderPublic
      ? await decryptMessage({ conversationId: detail.id, message, senderIdentityEd25519Public: senderPublic })
      : null;
    byId.set(message.id, { message, payload });
  }
  return items.map(
    (message) =>
      byId.get(message.id) ?? { message, payload: null },
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
