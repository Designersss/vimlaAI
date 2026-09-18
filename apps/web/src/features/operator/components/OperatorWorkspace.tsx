"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  ChatComposer,
  ConversationHeader,
  EmptyState,
  ErrorState,
  Spinner,
  UserMessage,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../auth/services/current-user";
import { ConsumerPage } from "../../shell/ConsumerPage";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../shared/i18n/persist-locale";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import { OperatorRunPanel } from "./OperatorRunPanel";
import {
  cancelOperatorRun,
  confirmOperatorRun,
  continueOperatorRun,
  createOperatorRun,
  fetchOperatorConversation,
  fetchOperatorRun,
  OperatorRequestError,
} from "../services/operator";
import type { ChatMessage, OperatorRunView } from "@vimla/contracts";
import chatStyles from "../../chat/components/ChatWorkspace/ChatWorkspace.module.scss";

export function OperatorWorkspace(): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<OperatorRunView | null>(null);

  useEffect(() => {
    if (!CONSUMER_FEATURES.vimlaOperator) {
      router.replace("/app");
      return;
    }
    let cancelled = false;
    void fetchCurrentUser()
      .then(async (currentUser) => {
        if (cancelled) {
          return;
        }
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
        const conversation = await fetchOperatorConversation();
        if (cancelled) {
          return;
        }
        setMessages(conversation.messages);
        const lastRun = [...conversation.messages].reverse().find((message) => message.operatorRun)?.operatorRun;
        if (lastRun?.confirmationRequired) {
          setPendingRun(await fetchOperatorRun(lastRun.id));
        } else {
          setPendingRun(lastRun ?? null);
        }
        setBoot("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [locale, router]);

  async function onSubmit(): Promise<void> {
    const content = draft.trim();
    if (sending || content.length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    setDraft("");
    try {
      if (pendingRun?.status === "AWAITING_CLARIFICATION") {
        const run = await continueOperatorRun(pendingRun.id, {
          clientRequestId: crypto.randomUUID(),
          content,
        });
        applyRun(run, content);
        return;
      }
      const run = await createOperatorRun({
        clientRequestId: crypto.randomUUID(),
        content,
      });
      applyRun(run, content);
    } catch (caught: unknown) {
      if (caught instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setError(caught instanceof OperatorRequestError ? caught.code : "internal_error");
    } finally {
      setSending(false);
    }
  }

  function applyRun(run: OperatorRunView, content: string): void {
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: `user-${now}`,
        role: "USER",
        content,
        status: "COMPLETE",
        createdAt: now,
        mentions: [],
      },
      {
        id: `assistant-${now}`,
        role: "ASSISTANT",
        content: run.publicMessage ?? "",
        status: "COMPLETE",
        createdAt: now,
        mentions: [],
        operatorRun: run,
      },
    ]);
    setPendingRun(run);
  }

  if (boot === "loading") {
    return (
      <p className={chatStyles.status}>
        <Spinner label={t("operator.loading")} />
      </p>
    );
  }

  if (boot === "failed") {
    return <ErrorState title={t("operator.failedLoad")} />;
  }

  return (
    <ConsumerPage flush>
      <section className={chatStyles.workspace} data-testid="operator-shell">
        <ConversationHeader title={t("operator.title")} />
        <div className={chatStyles.messages}>
          {messages.length === 0 ? (
            <EmptyState title={t("operator.empty")} />
          ) : (
            messages.map((message, index) =>
              message.role === "USER" ? (
                <UserMessage key={message.id} label={t("chat.you")}>
                  {message.content}
                </UserMessage>
              ) : (
                <OperatorRunPanel
                  key={message.id}
                  run={
                    message.operatorRun ?? {
                      id: message.id,
                      status: "SUCCEEDED",
                      publicMessage: message.content,
                      clarificationQuestion: null,
                      confirmationRequired: false,
                      confirmationToken: null,
                      errorCode: null,
                      actions: [],
                      conversationId: "",
                      invocationScope: "PERSONAL",
                      directConversationId: null,
                      contextOwnIncluded: false,
                      contextPeerIncluded: false,
                      contextPeerDenied: false,
                      createdAt: message.createdAt,
                      updatedAt: message.createdAt,
                    }
                  }
                  processing={sending && index === messages.length - 1}
                  onConfirm={() => {
                    if (!pendingRun?.confirmationToken) {
                      return;
                    }
                    void confirmOperatorRun(pendingRun.id, pendingRun.confirmationToken)
                      .then((run) => {
                        setPendingRun(run);
                        setMessages((current) =>
                          current.map((item) =>
                            item.operatorRun?.id === run.id ? { ...item, operatorRun: run, content: run.publicMessage ?? item.content } : item,
                          ),
                        );
                      })
                      .catch((caught: unknown) => {
                        setError(caught instanceof OperatorRequestError ? caught.code : "internal_error");
                      });
                  }}
                  onCancel={() => {
                    if (!pendingRun) {
                      return;
                    }
                    void cancelOperatorRun(pendingRun.id).then((run) => setPendingRun(run));
                  }}
                />
              ),
            )
          )}
        </div>
        {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => void onSubmit()}
          placeholder={t("operator.placeholder")}
          sendLabel={t("chat.send")}
          sending={sending}
          variant="operator"
        />
      </section>
    </ConsumerPage>
  );
}
