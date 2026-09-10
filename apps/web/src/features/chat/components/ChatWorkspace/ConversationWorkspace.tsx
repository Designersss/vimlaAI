"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AssistantMessage,
  ChatComposer,
  ConversationHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Button,
  ChevronLeftIcon,
  ModelModeControl,
  ModelPickerDialog,
  Spinner,
  UserMessage,
  VimlaMark,
  VimlaMentionChip,
  type AiInteractionMode,
  type AutoEffortLevel,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../../auth/services/current-user";
import { fetchUsage } from "../../../billing/services/usage";
import { fetchAiModels } from "../../services/models";
import { fetchConversation } from "../../services/conversations";
import { streamAssistantMessage } from "../../services/stream-message";
import { ChatWorkspaceStore } from "../../stores/chat-workspace-store";
import { ConsumerShell } from "../../../shell/ConsumerShell";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../../shared/i18n/persist-locale";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import styles from "./ChatWorkspace.module.scss";

export const ConversationWorkspace = observer(function ConversationWorkspace({
  conversationId,
}: {
  conversationId: string;
}): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [store] = useState(() => new ChatWorkspaceStore());
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [mode, setMode] = useState<AiInteractionMode>("pro");
  const [autoLevel, setAutoLevel] = useState<AutoEffortLevel>("medium");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mention, setMention] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), fetchUsage(), fetchAiModels(), fetchConversation(conversationId)])
      .then(async ([currentUser, usage, models, detail]) => {
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
        store.hydrate(usage, models, []);
        store.setActiveConversation(detail.id, detail.messages);
        setBoot("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, locale, router, store]);

  const selectedModel = useMemo(
    () => store.models.find((model) => model.id === store.selectedModelId),
    [store.models, store.selectedModelId],
  );

  async function onSubmit(): Promise<void> {
    if (store.streaming) {
      return;
    }
    const modelId = store.selectedModelId;
    const content = store.draft.trim();
    if (!modelId || content.length === 0) {
      return;
    }

    store.beginUserMessage(content);
    setMention(false);
    try {
      await streamAssistantMessage({
        conversationId,
        clientRequestId: crypto.randomUUID(),
        modelId,
        content,
        onDelta: (text) => store.appendAssistantDelta(text),
        onDone: () => {
          store.finishAssistant();
          void fetchUsage().then((usage) => store.setUsage(usage));
        },
        onError: (code) => store.failAssistant(code),
      });
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      store.failAssistant("internal_error");
    }
  }

  if (boot === "loading") {
    return (
      <p className={styles.status}>
        <Spinner label={t("chat.loading")} />
      </p>
    );
  }

  if (boot === "failed") {
    return <ErrorState title={t("chat.failed")} />;
  }

  return (
    <ConsumerShell title={t("nav.messages")} flush>
      <section className={styles.workspace}>
        <ConversationHeader
          back={
            <IconButton label={t("common.back")} onClick={() => router.push("/app")}>
              <ChevronLeftIcon size={18} />
            </IconButton>
          }
          title={t("nav.messages")}
        />
        <div className={styles.messages}>
          {store.messages.length === 0 ? (
            <EmptyState title={t("chat.empty")} />
          ) : (
            store.messages.map((message) =>
              message.role === "USER" ? (
                <UserMessage key={message.id} label={t("chat.you")}>
                  {message.content}
                </UserMessage>
              ) : (
                <AssistantMessage key={message.id} label={t("chat.assistant")}>
                  {message.content}
                </AssistantMessage>
              ),
            )
          )}
        </div>
        {store.error ? <Alert variant="error">{tx(t, apiErrorMessageKey(store.error))}</Alert> : null}
        <ChatComposer
          value={store.draft}
          onChange={(value) => store.setDraft(value)}
          onSubmit={() => void onSubmit()}
          placeholder={t("chat.placeholder")}
          sendLabel={t("chat.send")}
          sending={store.streaming}
          chips={
            mention ? (
              <VimlaMentionChip
                label={t("chat.mentionVimla")}
                onRemove={() => setMention(false)}
                removeLabel={t("common.close")}
              />
            ) : null
          }
          mentionControl={
            <Button
              variant={mention ? "primary" : "ghost"}
              size="sm"
              aria-pressed={mention}
              onClick={() => setMention((value) => !value)}
            >
              <VimlaMark size={16} aria-hidden="true" />
              {t("chat.mentionVimla")}
            </Button>
          }
          modelControl={
            <ModelModeControl
              mode={mode}
              autoLevel={autoLevel}
              autoEnabled={CONSUMER_FEATURES.autoRouter}
              selectedModelLabel={selectedModel?.displayName ?? t("chat.model")}
              autoLabel={t("chat.auto")}
              proLabel={t("chat.pro")}
              minimumLabel={t("chat.autoMinimum")}
              mediumLabel={t("chat.autoMedium")}
              maximumLabel={t("chat.autoMaximum")}
              autoUnavailableHint={t("chat.autoUnavailable")}
              onSelectAuto={(level) => {
                if (!CONSUMER_FEATURES.autoRouter) {
                  return;
                }
                setMode("auto");
                setAutoLevel(level);
              }}
              onSelectPro={() => {
                setMode("pro");
                setPickerOpen(true);
              }}
            />
          }
        />
        <ModelPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title={t("chat.pickModel")}
          searchLabel={t("chat.searchModels")}
          allLabel={t("chat.filterAll")}
          streamingLabel={t("chat.filterStreaming")}
          cancelLabel={t("common.cancel")}
          applyLabel={t("chat.applyModel")}
          emptyLabel={t("chat.noModels")}
          closeLabel={t("common.close")}
          models={store.models}
          selectedId={store.selectedModelId}
          onApply={(id) => store.setModel(id)}
        />
      </section>
    </ConsumerShell>
  );
});
