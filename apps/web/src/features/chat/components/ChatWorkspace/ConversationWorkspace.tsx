"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MentionSuggestionsResponse } from "@vimla/contracts";
import {
  Alert,
  AssistantMessage,
  ChatComposer,
  EmptyState,
  Button,
  MentionPicker,
  ModelModeControl,
  ModelPickerDialog,
  UserMessage,
  VimlaMark,
  VimlaMentionChip,
  type AiInteractionMode,
  type AutoEffortLevel,
  type MentionPickerOption,
} from "@vimla/ui";
import { AuthRequiredError } from "../../../auth/services/current-user";
import { fetchUsage } from "../../../billing/services/usage";
import { fetchAiModels } from "../../services/models";
import { fetchConversation } from "../../services/conversations";
import { fetchMentionSuggestions } from "../../services/mentions";
import { streamAssistantMessage } from "../../services/stream-message";
import { useChatWorkspace } from "./ChatWorkspaceProvider";
import { ChatConversationHeader } from "./ChatConversationHeader";
import { ChatDetailStatus } from "./ChatDetailStatus";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { OperatorRunPanel } from "../../../operator/components/OperatorRunPanel";
import {
  createOperatorRun,
  OperatorRequestError,
  confirmOperatorRun,
  cancelOperatorRun,
  fetchOperatorRun,
} from "../../../operator/services/operator";
import styles from "./ChatWorkspace.module.scss";

type ActiveMentionQuery = {
  start: number;
  end: number;
  query: string;
};

function findActiveMention(value: string): ActiveMentionQuery | null {
  const match = /(?:^|\s)@([a-zA-Z0-9._]*)$/.exec(value);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    start: value.length - query.length - 1,
    end: value.length,
    query,
  };
}

export const ConversationWorkspace = observer(function ConversationWorkspace({
  conversationId,
}: {
  conversationId: string;
}): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const workspace = useChatWorkspace();
  const [store] = useState(() => workspace.conversation(conversationId));
  const [title, setTitle] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [mode, setMode] = useState<AiInteractionMode>("pro");
  const [autoLevel, setAutoLevel] = useState<AutoEffortLevel>("medium");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mention, setMention] = useState(false);
  const [activeMention, setActiveMention] = useState<ActiveMentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestionsResponse | null>(null);
  const [mentionOptionIndex, setMentionOptionIndex] = useState(0);
  const operatorBusy = store.operatorBusy;
  const setOperatorBusy = (value: boolean): void => store.setOperatorBusy(value);

  useEffect(() => {
    let cancelled = false;
    const revision = store.revision;
    void Promise.all([fetchUsage(), fetchAiModels(), fetchConversation(conversationId)])
      .then(([usage, models, detail]) => {
        if (cancelled) return;
        workspace.hydrate(usage, models);
        store.setMessages(detail.messages, revision);
        setTitle(detail.title);
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
  }, [attempt, conversationId, router, store, workspace]);

  useEffect(() => {
    if (!activeMention) {
      setMentionSuggestions(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchMentionSuggestions({
        q: activeMention.query,
        conversationId,
      })
        .then((suggestions) => {
          if (cancelled) return;
          setMentionSuggestions(suggestions);
          setMentionOptionIndex(0);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (error instanceof AuthRequiredError) {
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

  const selectedModel = useMemo(
    () => workspace.models.find((model) => model.id === workspace.selectedModelId),
    [workspace.models, workspace.selectedModelId],
  );

  const mentionOptions = useMemo(
    () =>
      mentionSuggestions
        ? [...mentionSuggestions.people, ...mentionSuggestions.vimla, ...mentionSuggestions.ai]
        : [],
    [mentionSuggestions],
  );

  function closeMentionPicker(): void {
    setActiveMention(null);
    setMentionSuggestions(null);
    setMentionOptionIndex(0);
  }

  function handleDraftChange(value: string): void {
    store.setDraft(value);
    const nextMention = findActiveMention(value);
    setActiveMention(nextMention);
    if (!nextMention) {
      setMentionSuggestions(null);
    }
    setMentionOptionIndex(0);
  }

  function selectMention(option: MentionPickerOption): void {
    if (!activeMention) return;
    const nextValue = `${store.draft.slice(0, activeMention.start)}@${option.handle} ${store.draft.slice(activeMention.end)}`;
    store.setDraft(nextValue);
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

  async function onSubmit(): Promise<void> {
    if (store.streaming || operatorBusy) {
      return;
    }
    const content = store.draft.trim();
    if (content.length === 0) {
      return;
    }
    closeMentionPicker();

    if (CONSUMER_FEATURES.vimlaOperator && mention) {
      store.beginUserMessage(content);
      setMention(false);
      setOperatorBusy(true);
      try {
        const run = await createOperatorRun({
          clientRequestId: crypto.randomUUID(),
          content,
          conversationId,
        });
        store.finishOperator(run);
        void fetchUsage().then((usage) => workspace.setUsage(usage));
      } catch (error: unknown) {
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        store.failAssistant(error instanceof OperatorRequestError ? error.code : "internal_error");
      } finally {
        setOperatorBusy(false);
      }
      return;
    }

    const modelId = workspace.selectedModelId;
    if (!modelId) {
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
          void fetchUsage().then((usage) => workspace.setUsage(usage));
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

  if (boot !== "ready") {
    return <ChatDetailStatus failed={boot === "failed"} retry={() => { setBoot("loading"); setAttempt((value) => value + 1); }} />;
  }

  return (
    <section className={styles.workspace}>
      <ChatConversationHeader title={title ?? t("chat.newChat")} />
      <div className={styles.messages}>
        {store.messages.length === 0 ? (
          <EmptyState title={t("chat.empty")} />
        ) : (
          store.messages.map((message) =>
            message.role === "USER" ? (
              <UserMessage key={message.id} label={t("chat.you")}>
                {message.content}
              </UserMessage>
            ) : message.operatorRun ? (
              <OperatorRunPanel
                key={message.id}
                run={message.operatorRun}
                processing={operatorBusy}
                onConfirm={() => {
                  const runId = message.operatorRun?.id;
                  if (!runId) {
                    return;
                  }
                  setOperatorBusy(true);
                  void (async () => {
                    const token =
                      message.operatorRun?.confirmationToken ??
                      (await fetchOperatorRun(runId)).confirmationToken;
                    if (!token) {
                      throw new OperatorRequestError("operator_confirmation_invalid");
                    }
                    const run = await confirmOperatorRun(runId, token);
                    store.replaceOperator(run);
                  })()
                    .catch((error: unknown) => {
                      store.failAssistant(error instanceof OperatorRequestError ? error.code : "internal_error");
                    })
                    .finally(() => setOperatorBusy(false));
                }}
                onCancel={() => {
                  const runId = message.operatorRun?.id;
                  if (!runId) {
                    return;
                  }
                  void cancelOperatorRun(runId).then((run) => store.replaceOperator(run));
                }}
              />
            ) : (
              <AssistantMessage key={message.id} label={t("chat.assistant")}>
                {message.content}
              </AssistantMessage>
            ),
          )
        )}
      </div>
      <div onKeyDown={handleComposerKeyDown}>
        {store.error ? <Alert variant="error">{tx(t, apiErrorMessageKey(store.error))}</Alert> : null}
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
          value={store.draft}
          onChange={handleDraftChange}
          onSubmit={() => void onSubmit()}
          placeholder={t("chat.placeholder")}
          sendLabel={t("chat.send")}
          sending={store.streaming || operatorBusy}
          variant={mention ? "operator" : "ai"}
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
            CONSUMER_FEATURES.vimlaOperator ? (
              <Button
                variant={mention ? "primary" : "ghost"}
                size="sm"
                aria-pressed={mention}
                onClick={() => setMention((value) => !value)}
              >
                <VimlaMark size={16} aria-hidden="true" />
                {t("chat.mentionVimla")}
              </Button>
            ) : undefined
          }
          modelControl={
            mention ? undefined : (
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
            )
          }
        />
      </div>
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
        models={workspace.models}
        selectedId={workspace.selectedModelId}
        onApply={(id) => workspace.setModel(id)}
      />
    </section>
  );
});
