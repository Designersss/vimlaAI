"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { CurrentUser, UsageResponse } from "@vimla/contracts";
import { AuthRequiredError, fetchCurrentUser } from "../../../auth/services/current-user";
import { authClient } from "../../../auth/services/auth-client";
import { fetchUsage } from "../../../billing/services/usage";
import { fetchAiModels } from "../../services/models";
import {
  createConversation,
  fetchConversation,
  fetchConversations,
} from "../../services/conversations";
import { streamAssistantMessage } from "../../services/stream-message";
import { ChatWorkspaceStore } from "../../stores/chat-workspace-store";
import styles from "./ChatWorkspace.module.scss";

export const ChatWorkspace = observer(function ChatWorkspace(): ReactElement {
  const router = useRouter();
  const [store] = useState(() => new ChatWorkspaceStore());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), fetchUsage(), fetchAiModels(), fetchConversations()])
      .then(([currentUser, usage, models, conversations]) => {
        if (cancelled) {
          return;
        }
        setUser(currentUser);
        store.hydrate(usage, models, conversations);
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
  }, [router, store]);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  async function onNewChat(): Promise<void> {
    const conversation = await createConversation();
    store.addConversation(conversation);
    await loadConversation(store, conversation.id);
  }

  async function onSelect(id: string): Promise<void> {
    await loadConversation(store, id);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (store.streaming) {
      return;
    }

    if (!store.activeConversationId) {
      await onNewChat();
    }

    const conversationId = store.activeConversationId;
    const modelId = store.selectedModelId;
    const content = store.draft.trim();
    if (!conversationId || !modelId || content.length === 0) {
      return;
    }

    store.beginUserMessage(content);
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
    return <p className={styles.status}>Loading Vimla…</p>;
  }

  if (boot === "failed" || !user) {
    return <p className={styles.status}>Unable to load the workspace.</p>;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>Vimla</p>
        <button type="button" className={styles.button} onClick={() => void onNewChat()}>
          New chat
        </button>
        <nav className={styles.list}>
          {store.conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={conversation.id === store.activeConversationId ? styles.activeItem : styles.item}
              onClick={() => void onSelect(conversation.id)}
            >
              {conversation.title ?? "New chat"}
            </button>
          ))}
        </nav>
      </aside>
      <section className={styles.main}>
        <header className={styles.header}>
          <label className={styles.model}>
            Model
            <select
              value={store.selectedModelId}
              onChange={(event) => store.setModel(event.target.value)}
            >
              {store.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <UsageMeter usage={store.usage} />
          <p className={styles.user}>{user.email}</p>
          <button type="button" className={styles.button} onClick={() => void signOut()}>
            Sign out
          </button>
        </header>
        <div className={styles.messages}>
          {store.messages.map((message) => (
            <article key={message.id} className={styles.message}>
              <p className={styles.role}>{message.role === "USER" ? "You" : "Vimla"}</p>
              <p className={styles.content}>{message.content}</p>
            </article>
          ))}
        </div>
        {store.error ? <p className={styles.error}>{store.error}</p> : null}
        <form className={styles.composer} onSubmit={(event) => void onSubmit(event)}>
          <textarea
            value={store.draft}
            onChange={(event) => store.setDraft(event.target.value)}
            placeholder="Message Vimla"
            rows={3}
          />
          <button type="submit" className={styles.send} disabled={store.streaming}>
            Send
          </button>
        </form>
      </section>
    </div>
  );
});

function UsageMeter({ usage }: { usage: UsageResponse | null }): ReactElement {
  if (!usage) {
    return <p className={styles.usage}>Usage unavailable</p>;
  }

  return (
    <div className={styles.usage}>
      <p>Monthly Usage</p>
      <div className={styles.bar} aria-hidden="true">
        <span style={{ width: `${usage.monthly.usedPercent}%` }} />
      </div>
      <p>{usage.monthly.usedPercent}%</p>
      <p>Top-up {usage.topup.usedPercent}% used</p>
    </div>
  );
}

async function loadConversation(store: ChatWorkspaceStore, id: string): Promise<void> {
  const detail = await fetchConversation(id);
  store.setActiveConversation(id, detail.messages);
}

