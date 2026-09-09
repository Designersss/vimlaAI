"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { CurrentUser, UsageResponse } from "@vimla/contracts";
import {
  AiModeSelector,
  Alert,
  AppShell,
  AssistantMessage,
  Button,
  ChatComposer,
  ConversationItem,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  LogOutIcon,
  MenuIcon,
  ModelSelector,
  PlusIcon,
  SettingsIcon,
  Sidebar,
  SidebarFooter,
  SidebarSection,
  Spinner,
  UsageMeter,
  UserMessage,
  buttonClassName,
  type AiInteractionMode,
} from "@vimla/ui";
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
import { CanonicalNav } from "../../../shell/CanonicalNav";
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
  const [navOpen, setNavOpen] = useState(false);
  const [mode, setMode] = useState<AiInteractionMode>("pro");

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
    setNavOpen(false);
  }

  async function onSelect(id: string): Promise<void> {
    await loadConversation(store, id);
    setNavOpen(false);
  }

  async function onSubmit(): Promise<void> {
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
    return (
      <p className={styles.status}>
        <Spinner label={t("chat.loading")} />
      </p>
    );
  }

  if (boot === "failed" || !user) {
    return <ErrorState title={t("chat.failed")} />;
  }

  const sidebar = (
    <Sidebar>
      <p className={styles.brand}>{t("meta.productName")}</p>
      <div className={styles.canonical}>
        <CanonicalNav />
      </div>
      <Button variant="secondary" onClick={() => void onNewChat()}>
        <PlusIcon size={16} aria-hidden="true" />
        {t("chat.newChat")}
      </Button>
      <SidebarSection>
        {store.conversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            title={conversation.title ?? t("chat.newChat")}
            active={conversation.id === store.activeConversationId}
            onSelect={() => void onSelect(conversation.id)}
          />
        ))}
      </SidebarSection>
      <SidebarFooter>
        <UsageBlock usage={store.usage} />
        <LanguageSwitcher />
        <p className={styles.user}>{user.email}</p>
        <Link href="/settings/billing" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          {t("nav.billing")}
        </Link>
        <Link href="/settings/security" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          <SettingsIcon size={16} aria-hidden="true" />
          {t("nav.settings")}
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOutIcon size={16} aria-hidden="true" />
          {t("nav.signOut")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );

  return (
    <>
      <AppShell
        sidebar={sidebar}
        topbar={
          <>
            <IconButton label={t("chat.openMenu")} onClick={() => setNavOpen(true)}>
              <MenuIcon size={18} />
            </IconButton>
            <strong>{t("meta.productName")}</strong>
          </>
        }
      >
        <section className={styles.workspace}>
          <header className={styles.header}>
            <div className={styles.mode}>
              <AiModeSelector
                mode={mode}
                onModeChange={setMode}
                label={t("chat.mode")}
                proLabel={t("chat.pro")}
                autoLabel={t("chat.auto")}
                autoEnabled={false}
                autoHint={t("chat.autoUnavailable")}
                proControl={
                  <div className={styles.modelLabel}>
                    <ModelSelector
                      label={t("chat.model")}
                      value={store.selectedModelId}
                      onChange={(value) => store.setModel(value)}
                      options={store.models.map((model) => ({ id: model.id, label: model.displayName }))}
                    />
                  </div>
                }
              />
            </div>
            <div className={styles.headerCluster}>
              <UsageBlock usage={store.usage} />
            </div>
          </header>
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
          {!user.emailVerified ? <Alert variant="warning">{t("chat.verifyToSend")}</Alert> : null}
          <ChatComposer
            value={store.draft}
            onChange={(value) => store.setDraft(value)}
            onSubmit={() => void onSubmit()}
            placeholder={t("chat.placeholder")}
            sendLabel={t("chat.send")}
            disabled={!user.emailVerified}
            sending={store.streaming}
          />
        </section>
      </AppShell>
      <Drawer open={navOpen} onOpenChange={setNavOpen} title={t("meta.productName")} closeLabel={t("common.close")}>
        {sidebar}
      </Drawer>
    </>
  );
});

function UsageBlock({ usage }: { usage: UsageResponse | null }): ReactElement {
  const t = useTranslations("chat");
  if (!usage) {
    return <p className={styles.user}>{t("usageUnavailable")}</p>;
  }
  return (
    <UsageMeter
      label={t("monthlyUsage")}
      percent={usage.monthly.usedPercent}
      caption={`${usage.monthly.usedPercent}% · ${t("topupUsed", { percent: usage.topup.usedPercent })}`}
    />
  );
}

async function loadConversation(store: ChatWorkspaceStore, id: string): Promise<void> {
  const detail = await fetchConversation(id);
  store.setActiveConversation(id, detail.messages);
}
