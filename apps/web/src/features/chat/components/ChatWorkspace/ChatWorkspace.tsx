"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { LanguageSwitcher } from "../../../../shared/i18n/LanguageSwitcher";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../../shared/i18n/persist-locale";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import styles from "./ChatWorkspace.module.scss";

export const ChatWorkspace = observer(function ChatWorkspace(): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [store] = useState(() => new ChatWorkspaceStore());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), fetchUsage(), fetchAiModels(), fetchConversations()])
      .then(async ([currentUser, usage, models, conversations]) => {
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
  }, [locale, router, store]);

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
    if (store.streaming || !user?.emailVerified) {
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
    return <p className={styles.status}>{t("chat.loading")}</p>;
  }

  if (boot === "failed" || !user) {
    return <p className={styles.status}>{t("chat.failed")}</p>;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>{t("meta.productName")}</p>
        <button type="button" className={styles.button} onClick={() => void onNewChat()}>
          {t("chat.newChat")}
        </button>
        <nav className={styles.list}>
          {store.conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={conversation.id === store.activeConversationId ? styles.activeItem : styles.item}
              onClick={() => void onSelect(conversation.id)}
            >
              {conversation.title ?? t("chat.newChat")}
            </button>
          ))}
        </nav>
      </aside>
      <section className={styles.main}>
        <header className={styles.header}>
          <label className={styles.model}>
            {t("chat.model")}
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
          <LanguageSwitcher />
          <p className={styles.user}>{user.email}</p>
          <Link href="/settings/billing" className={styles.button}>
            {t("nav.billing")}
          </Link>
          <Link href="/settings/security" className={styles.button}>
            {t("nav.settings")}
          </Link>
          <button type="button" className={styles.button} onClick={() => void signOut()}>
            {t("nav.signOut")}
          </button>
        </header>
        <div className={styles.messages}>
          {store.messages.length === 0 ? <p className={styles.muted}>{t("chat.empty")}</p> : null}
          {store.messages.map((message) => (
            <article key={message.id} className={styles.message}>
              <p className={styles.role}>{message.role === "USER" ? t("chat.you") : t("chat.assistant")}</p>
              <p className={styles.content}>{message.content}</p>
            </article>
          ))}
        </div>
        {store.error ? (
          <p className={styles.error}>{tx(t, apiErrorMessageKey(store.error))}</p>
        ) : null}
        {!user.emailVerified ? <p className={styles.error}>{t("chat.verifyToSend")}</p> : null}
        <form className={styles.composer} onSubmit={(event) => void onSubmit(event)}>
          <textarea
            value={store.draft}
            onChange={(event) => store.setDraft(event.target.value)}
            placeholder={t("chat.placeholder")}
            rows={3}
            disabled={!user.emailVerified}
          />
          <button
            type="submit"
            className={styles.send}
            disabled={store.streaming || !user.emailVerified}
          >
            {t("chat.send")}
          </button>
        </form>
      </section>
    </div>
  );
});

function UsageMeter({ usage }: { usage: UsageResponse | null }): ReactElement {
  const t = useTranslations("chat");
  if (!usage) {
    return <p className={styles.usage}>{t("usageUnavailable")}</p>;
  }

  return (
    <div className={styles.usage}>
      <p>{t("monthlyUsage")}</p>
      <div className={styles.bar} aria-hidden="true">
        <span style={{ width: `${usage.monthly.usedPercent}%` }} />
      </div>
      <p>{usage.monthly.usedPercent}%</p>
      <p>{t("topupUsed", { percent: usage.topup.usedPercent })}</p>
    </div>
  );
}

async function loadConversation(store: ChatWorkspaceStore, id: string): Promise<void> {
  const detail = await fetchConversation(id);
  store.setActiveConversation(id, detail.messages);
}
