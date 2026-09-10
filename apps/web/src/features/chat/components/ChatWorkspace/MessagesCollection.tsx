"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AIConversationRow,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PlusIcon,
  SearchInput,
  Spinner,
  Heading,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../../auth/services/current-user";
import { fetchConversations, createConversation } from "../../services/conversations";
import { ChatWorkspaceStore } from "../../stores/chat-workspace-store";
import { NotificationBell } from "../../../notifications/components/NotificationBell";
import { ConsumerShell } from "../../../shell/ConsumerShell";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../../shared/i18n/persist-locale";
import styles from "./ChatWorkspace.module.scss";

export const MessagesCollection = observer(function MessagesCollection(): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [store] = useState(() => new ChatWorkspaceStore());
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), fetchConversations()])
      .then(async ([currentUser, conversations]) => {
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
        store.setConversations(conversations);
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

  async function onNewChat(): Promise<void> {
    const conversation = await createConversation();
    router.push(`/app/${conversation.id}`);
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

  const filtered = store.conversations.filter((conversation) => {
    const title = conversation.title ?? t("chat.newChat");
    return title.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <ConsumerShell title={t("nav.messages")} actions={<NotificationBell />}>
      <div className={styles.collection}>
        <PageHeader
          title={
            <Heading as="h1" size="page">
              {t("nav.messages")}
            </Heading>
          }
          actions={
            <Button onClick={() => void onNewChat()}>
              <PlusIcon size={16} aria-hidden="true" />
              {t("chat.newChat")}
            </Button>
          }
        />
        <SearchInput
          aria-label={t("chat.search")}
          placeholder={t("chat.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {filtered.length === 0 ? (
          <EmptyState title={t("chat.empty")} />
        ) : (
          <div className={styles.list}>
            {filtered.map((conversation) => (
              <AIConversationRow
                key={conversation.id}
                title={conversation.title ?? t("chat.newChat")}
                onSelect={() => router.push(`/app/${conversation.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </ConsumerShell>
  );
});
