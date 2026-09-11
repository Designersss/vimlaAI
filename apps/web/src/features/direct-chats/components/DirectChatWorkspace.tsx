"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { DirectConversationView, DirectMessageKind, DirectMessageView, OperatorRunView } from "@vimla/contracts";
import {
  Alert,
  AssistantMessage,
  Badge,
  Button,
  Card,
  ChatComposer,
  ChevronLeftIcon,
  ConversationHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Spinner,
  Switch,
  Text,
  UserMessage,
  VimlaMark,
  VimlaMentionChip,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../auth/services/current-user";
import { NotificationBell } from "../../notifications/components/NotificationBell";
import { ConsumerShell } from "../../shell/ConsumerShell";
import { OperatorRunPanel } from "../../operator/components/OperatorRunPanel";
import {
  OperatorRequestError,
  cancelOperatorRun,
  confirmOperatorRun,
  createOperatorRun,
  fetchOperatorRun,
} from "../../operator/services/operator";
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
import { savePlaintext } from "../services/crypto-store";
import { decodeDirectPlaintext, encodeDirectPlaintext, type DirectPlaintextPayload } from "../services/payload";
import { decryptMessage, encryptForDevices, ensureLocalDevice } from "../services/session";
import styles from "./DirectChatWorkspace.module.scss";

interface DecryptedRow {
  message: DirectMessageView;
  payload: DirectPlaintextPayload | null;
}

export function DirectChatWorkspace({ conversationId }: { conversationId: string }): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<DirectConversationView | null>(null);
  const [rows, setRows] = useState<DecryptedRow[]>([]);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [mention, setMention] = useState(false);
  const mentionRef = useRef(false);
  const [sending, setSending] = useState(false);
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
        if (cancelled) {
          return;
        }
        const cookieLocale = readLocaleCookie();
        if (cookieLocale && cookieLocale !== locale) {
          router.refresh();
          return;
        }
        await ensureLocalDevice();
        const detail = await fetchDirectConversation(conversationId);
        const device = await ensureLocalDevice();
        const page = await fetchDirectMessages(conversationId, device.deviceId);
        const decrypted = await decryptPage(detail, page.items);
        if (cancelled) {
          return;
        }
        setUserId(currentUser.id);
        setConversation(detail);
        setRows(decrypted.reverse());
        setNextCursor(page.nextCursor);
        setBoot("ready");
        await markDirectChatRead(conversationId);
      } catch (caught: unknown) {
        if (cancelled) {
          return;
        }
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
  }, [conversationId, locale, router]);

  async function reloadConversation(): Promise<DirectConversationView> {
    const detail = await fetchDirectConversation(conversationId);
    setConversation(detail);
    return detail;
  }

  async function onSend(): Promise<void> {
    const text = draftRef.current.trim();
    if (sending || operatorBusy || text.length === 0 || !conversation || !userId) {
      return;
    }
    draftRef.current = "";
    setDraft("");
    if (CONSUMER_FEATURES.vimlaOperator && mentionRef.current) {
      mentionRef.current = false;
      setMention(false);
      await invokeOperator(text);
      return;
    }
    await postEncrypted("HUMAN", encodeDirectPlaintext({ type: "human", text }));
  }

  async function invokeOperator(text: string): Promise<void> {
    if (!conversation || !userId) {
      return;
    }
    setMention(false);
    mentionRef.current = false;
    setOperatorBusy(true);
    setError(null);
    try {
      await postEncrypted(
        "OPERATOR_INVOKE",
        encodeDirectPlaintext({
          type: "invoke",
          text,
          contextShared: false,
          peerIncluded: false,
        }),
      );
      const contextBundle = {
        messages: rows.flatMap((row) => {
          if (!row.payload || row.payload.type !== "human") {
            return [];
          }
          const own = row.message.senderUserId === userId;
          if (own && !conversation.privacy.shareOwnHistoryWithVimla) {
            return [];
          }
          if (!own && (!conversation.privacy.includePeerHistoryWhenInvoking || !conversation.privacy.peerShareOwnHistoryWithVimla)) {
            return [];
          }
          return [
            {
              senderUserId: row.message.senderUserId,
              sentAt: row.message.createdAt,
              text: row.payload.text,
            },
          ];
        }),
      };
      const run = await createOperatorRun({
        clientRequestId: crypto.randomUUID(),
        content: text,
        invocationScope: "DIRECT_CHAT",
        directConversationId: conversation.id,
        ...(contextBundle.messages.length > 0 ? { contextBundle } : {}),
      });
      setPendingRun(run);
      if (run.publicMessage) {
        await postEncrypted(
          "OPERATOR_RESPONSE",
          encodeDirectPlaintext({ type: "response", text: run.publicMessage, runId: run.id }),
        );
      }
      const action = run.actions[0];
      if (action) {
        await postEncrypted(
          "OPERATOR_ACTION",
          encodeDirectPlaintext({
            type: "action",
            title: action.title,
            detail: action.detail,
            status: action.status,
          }),
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

  async function postEncrypted(kind: DirectMessageKind, plaintext: string): Promise<void> {
    if (!conversation || !userId) {
      return;
    }
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
      });
      const created = await sendDirectMessage(latest.id, {
        clientMessageId: crypto.randomUUID(),
        senderDeviceId: device.deviceId,
        kind,
        envelopes,
      });
      await savePlaintext({
        conversationId: latest.id,
        messageId: created.id,
        text: plaintext,
        kind,
        senderUserId: userId,
        createdAt: created.createdAt,
      });
      setRows((current) => [
        ...current,
        { message: created, payload: decodeDirectPlaintext(kind, plaintext) },
      ]);
    } catch (caught: unknown) {
      setError(caught instanceof DirectChatsApiError ? caught.code : "internal_error");
    } finally {
      setSending(false);
    }
  }

  async function onLoadOlder(): Promise<void> {
    if (!nextCursor || !conversation) {
      return;
    }
    const device = await ensureLocalDevice();
    const page = await fetchDirectMessages(conversationId, device.deviceId, nextCursor);
    const decrypted = await decryptPage(conversation, page.items);
    setRows((current) => [...decrypted.reverse(), ...current]);
    setNextCursor(page.nextCursor);
  }

  if (boot === "loading") {
    return (
      <p className={styles.status}>
        <Spinner label={t("direct.loading")} />
      </p>
    );
  }

  if (boot === "failed" || !conversation) {
    return <ErrorState title={t("direct.failed")} />;
  }

  return (
    <ConsumerShell title={conversation.peer.name} actions={<NotificationBell />}>
      <div className={styles.workspace} data-testid="direct-chat-shell">
        <ConversationHeader
          title={conversation.peer.name}
          subtitle={t("direct.e2eeSubtitle")}
          back={
            <IconButton label={t("common.back")} onClick={() => router.push("/app")}>
              <ChevronLeftIcon size={18} />
            </IconButton>
          }
        />
        <div className={styles.privacy}>
          <Switch
            label={t("direct.shareOwn")}
            checked={conversation.privacy.shareOwnHistoryWithVimla}
            onChange={(event) => {
              void updateDirectChatPrivacy(conversation.id, {
                shareOwnHistoryWithVimla: event.currentTarget.checked,
              }).then(setConversation);
            }}
          />
          <Switch
            label={t("direct.includePeer")}
            checked={conversation.privacy.includePeerHistoryWhenInvoking}
            onChange={(event) => {
              void updateDirectChatPrivacy(conversation.id, {
                includePeerHistoryWhenInvoking: event.currentTarget.checked,
              }).then(setConversation);
            }}
          />
          <Text tone="caption">
            {conversation.privacy.peerShareOwnHistoryWithVimla ? t("direct.peerAllowed") : t("direct.peerDenied")}
          </Text>
        </div>
        <div className={styles.messages}>
          {nextCursor ? (
            <Button variant="ghost" onClick={() => void onLoadOlder()}>
              {t("direct.loadOlder")}
            </Button>
          ) : null}
          {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
          {rows.length === 0 ? <EmptyState title={t("direct.empty")} /> : null}
          {rows.map((row) => (
            <DirectRow
              key={row.message.id}
              row={row}
              self={row.message.senderUserId === userId}
              youLabel={t("chat.you")}
              peerName={conversation.peer.name}
            />
          ))}
          {pendingRun ? (
            <OperatorRunPanel
              run={pendingRun}
              processing={operatorBusy}
              onConfirm={() => {
                setOperatorBusy(true);
                void (async () => {
                  const token = pendingRun.confirmationToken ?? (await fetchOperatorRun(pendingRun.id)).confirmationToken;
                  if (!token) {
                    throw new OperatorRequestError("operator_confirmation_invalid");
                  }
                  const run = await confirmOperatorRun(pendingRun.id, token);
                  setPendingRun(run);
                  if (run.publicMessage) {
                    await postEncrypted(
                      "OPERATOR_RESPONSE",
                      encodeDirectPlaintext({ type: "response", text: run.publicMessage, runId: run.id }),
                    );
                  }
                })()
                  .catch((caught: unknown) => {
                    setError(caught instanceof OperatorRequestError ? caught.code : "internal_error");
                  })
                  .finally(() => setOperatorBusy(false));
              }}
              onCancel={() => {
                void cancelOperatorRun(pendingRun.id).then(setPendingRun);
              }}
            />
          ) : null}
        </div>
        <ChatComposer
          variant="direct"
          value={draft}
          onChange={(value) => {
            draftRef.current = value;
            setDraft(value);
          }}
          onSubmit={() => void onSend()}
          placeholder={t("direct.placeholder")}
          sendLabel={t("chat.send")}
          sending={sending || operatorBusy}
          mentionControl={
            CONSUMER_FEATURES.vimlaOperator ? (
              <Button
                type="button"
                variant={mention ? "primary" : "ghost"}
                onClick={() => {
                  setMention((value) => {
                    const next = !value;
                    mentionRef.current = next;
                    return next;
                  });
                }}
                aria-pressed={mention}
              >
                <VimlaMark size={14} />
                {t("chat.mentionVimla")}
              </Button>
            ) : null
          }
          chips={
            mention ? (
              <VimlaMentionChip
                label={t("chat.mentionVimla")}
                onRemove={() => {
                  mentionRef.current = false;
                  setMention(false);
                }}
                removeLabel={t("common.close")}
              />
            ) : null
          }
        />
      </div>
    </ConsumerShell>
  );
}

async function decryptPage(detail: DirectConversationView, items: DirectMessageView[]): Promise<DecryptedRow[]> {
  const map = new Map(detail.devices.map((device) => [device.id, device.identityEd25519Public]));
  const decrypted: DecryptedRow[] = [];
  for (const message of items) {
    const senderPublic = map.get(message.senderDeviceId) ?? message.envelope?.x3dhInit?.identityEd25519Public ?? "";
    const payload = senderPublic
      ? await decryptMessage({
          conversationId: detail.id,
          message,
          senderIdentityEd25519Public: senderPublic,
        })
      : null;
    decrypted.push({ message, payload });
  }
  return decrypted;
}

function DirectRow({
  row,
  self,
  youLabel,
  peerName,
}: {
  row: DecryptedRow;
  self: boolean;
  youLabel: string;
  peerName: string;
}): ReactElement {
  const t = useTranslations();
  const label = self ? youLabel : peerName;
  if (!row.payload) {
    return (
      <article className={styles.undecryptable} data-testid="direct-message-undecryptable">
        <Text tone="caption">{t("direct.undecryptable")}</Text>
      </article>
    );
  }
  if (row.payload.type === "human") {
    return self ? (
      <UserMessage label={label}>
        <span data-testid="direct-message-human">{row.payload.text}</span>
      </UserMessage>
    ) : (
      <AssistantMessage label={label}>
        <span data-testid="direct-message-human">{row.payload.text}</span>
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
      </Card>
    );
  }
  if (row.payload.type === "response") {
    return (
      <AssistantMessage label={t("chat.assistant")}>
        <span data-testid="direct-message-response">{row.payload.text}</span>
      </AssistantMessage>
    );
  }
  return (
    <Card data-testid="direct-message-action">
      <Badge variant="accent">{t("direct.action")}</Badge>
      <Text>{row.payload.title}</Text>
      {row.payload.detail ? <Text tone="secondary">{row.payload.detail}</Text> : null}
    </Card>
  );
}
