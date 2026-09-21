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
  MentionPicker,
  ModelModeControl,
  ModelPickerDialog,
  UserMessage,
  type AiInteractionMode,
  type AutoEffortLevel,
  type MentionPickerOption,
} from "@vimla/ui";
import { AuthRequiredError } from "../../../auth/services/current-user";
import { fetchUsage } from "../../../billing/services/usage";
import { fetchAiModels } from "../../services/models";
import { fetchConversation } from "../../services/conversations";
import { fetchMentionSuggestions } from "../../services/mentions";
import {
  createComposerMention,
  reconcileComposerMentions,
  resolveTypedComposerMentions,
  toMessageMentionInputs,
  type ComposerMention,
} from "../../services/composer-mentions";
import { streamAssistantMessage } from "../../services/stream-message";
import { useChatWorkspace } from "./ChatWorkspaceProvider";
import { ChatConversationHeader } from "./ChatConversationHeader";
import { ChatDetailStatus } from "./ChatDetailStatus";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { OperatorRunPanel } from "../../../operator/components/OperatorRunPanel";
import { WorkflowLane } from "../../../workflows/components/WorkflowLane";
import {
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
  const [activeMention, setActiveMention] = useState<ActiveMentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestionsResponse | null>(null);
  const [mentionOptionIndex, setMentionOptionIndex] = useState(0);
  const [composerMentions, setComposerMentions] = useState<ComposerMention[]>([]);
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
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
    const nextMention = findActiveMention(value);
    setComposerMentions((current) => {
      let reconciled = reconcileComposerMentions(store.draft, value, current);
      const queryToResolve = nextMention ?? activeMention;
      if (!queryToResolve) return reconciled;

      const exact = exactMentionOption(mentionOptions, queryToResolve.query);
      const token = `@${queryToResolve.query}`;
      if (!exact || value.slice(queryToResolve.start, queryToResolve.start + token.length) !== token) {
        return reconciled;
      }

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
    store.setDraft(value);
    setMentionSuggestions(null);
    setActiveMention(nextMention);
    setMentionOptionIndex(0);
  }

  function selectMention(option: MentionPickerOption): void {
    if (!activeMention) return;
    const nextValue = `${store.draft.slice(0, activeMention.start)}@${option.handle} ${store.draft.slice(activeMention.end)}`;
    const selected = createComposerMention({
      localId: crypto.randomUUID(),
      handleId: option.id,
      kind: option.kind,
      canonicalHandle: option.handle,
      startOffset: activeMention.start,
    });
    store.setDraft(nextValue);
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

  async function onSubmit(): Promise<void> {
    if (store.streaming || operatorBusy) {
      return;
    }
    const content = store.draft;
    if (content.trim().length === 0) {
      return;
    }
    closeMentionPicker();

    const modelId = workspace.selectedModelId;
    if (!modelId) {
      return;
    }

    let resolvedComposerMentions = composerMentions;
    if (content.includes("@")) {
      try {
        const suggestions = await fetchMentionSuggestions({ q: "", conversationId });
        resolvedComposerMentions = resolveTypedComposerMentions(content, [
          ...suggestions.people,
          ...suggestions.vimla,
          ...suggestions.ai,
        ]);
      } catch (error: unknown) {
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        store.failAssistant("internal_error");
        return;
      }
    }

    const mentions = toMessageMentionInputs(resolvedComposerMentions);
    const invocationMention = resolvedComposerMentions.some((candidate) => candidate.kind !== "USER");
    setComposerMentions([]);

    if (invocationMention) {
      const revision = store.revision;
      store.setDraft("");
      setOperatorBusy(true);
      let failed = false;
      try {
        await streamAssistantMessage({
          conversationId,
          clientRequestId: crypto.randomUUID(),
          modelId,
          content,
          mentions,
          onDelta: () => undefined,
          onRoute: () => undefined,
          onDone: () => undefined,
          onError: (code) => {
            failed = true;
            store.failAssistant(code);
          },
        });
        if (!failed) {
          const detail = await fetchConversation(conversationId);
          store.setMessages(detail.messages, revision);
          setTitle(detail.title);
          setWorkflowRefreshToken((value) => value + 1);
        }
      } catch (error: unknown) {
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        store.failAssistant("internal_error");
      } finally {
        setOperatorBusy(false);
      }
      return;
    }

    store.beginUserMessage(content);
    try {
      await streamAssistantMessage({
        conversationId,
        clientRequestId: crypto.randomUUID(),
        modelId,
        content,
        mentions,
        onDelta: (text) => store.appendAssistantDelta(text),
        onDone: () => {
          store.finishAssistant();
          setWorkflowRefreshToken((value) => value + 1);
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
      {CONSUMER_FEATURES.orchestrationUi ? (
        <WorkflowLane
          key={conversationId}
          conversationId={conversationId}
          refreshToken={workflowRefreshToken}
        />
      ) : null}
      <div style={{ position: "relative" }} onKeyDown={handleComposerKeyDown}>
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
          highlights={composerMentions}
          variant="ai"
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
