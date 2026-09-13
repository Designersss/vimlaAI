"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { DirectConversationSummary } from "@vimla/contracts";
import {
  AIConversationRow,
  Alert,
  Button,
  Dialog,
  DirectConversationRow,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  PlusIcon,
  SearchInput,
  Segment,
  SegmentedControl,
  Spinner,
  Heading,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../../auth/services/current-user";
import { fetchConversations, createConversation } from "../../services/conversations";
import { ChatWorkspaceStore } from "../../stores/chat-workspace-store";
import { NotificationBell } from "../../../notifications/components/NotificationBell";
import { ConsumerShell } from "../../../shell/ConsumerShell";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../../../shared/i18n/persist-locale";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import {
  DirectChatsApiError,
  createDirectConversation,
  fetchDirectConversations,
} from "../../../direct-chats/services/api";
import { ensureLocalDevice } from "../../../direct-chats/services/session";
import styles from "./ChatWorkspace.module.scss";

type InboxTab = "all" | "ai" | "direct";

export const MessagesCollection = observer(function MessagesCollection(): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [store] = useState(() => new ChatWorkspaceStore());
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [directItems, setDirectItems] = useState<DirectConversationSummary[]>([]);
  const [directOpen, setDirectOpen] = useState(false);
  const [peerEmail, setPeerEmail] = useState("");
  const [directError, setDirectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchCurrentUser(),
      fetchConversations(),
      CONSUMER_FEATURES.directChats ? fetchDirectConversations() : Promise.resolve({ items: [], nextCursor: null }),
    ])
      .then(async ([currentUser, conversations, directPage]) => {
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
        if (CONSUMER_FEATURES.directChats) {
          await ensureLocalDevice(currentUser.id);
        }
        store.setConversations(conversations);
        setDirectItems(directPage.items);
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

  async function onCreateDirect(event: FormEvent): Promise<void> {
    event.preventDefault();
    setDirectError(null);
    try {
      const currentUser = await fetchCurrentUser();
      await ensureLocalDevice(currentUser.id);
      const created = await createDirectConversation({ peerEmail });
      setDirectOpen(false);
      setPeerEmail("");
      router.push(`/app/direct/${created.id}`);
    } catch (caught: unknown) {
      setDirectError(caught instanceof DirectChatsApiError ? caught.code : "internal_error");
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

  const filteredAi = store.conversations.filter((conversation) => {
    const title = conversation.title ?? t("chat.newChat");
    return title.toLowerCase().includes(query.trim().toLowerCase());
  });
  const filteredDirect = directItems.filter((item) =>
    item.peer.name.toLowerCase().includes(query.trim().toLowerCase()) ||
    item.peer.email.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const showAi = !CONSUMER_FEATURES.directChats || tab === "all" || tab === "ai";
  const showDirect = CONSUMER_FEATURES.directChats && (tab === "all" || tab === "direct");

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
            <>
              {CONSUMER_FEATURES.directChats ? (
                <Button variant="secondary" onClick={() => setDirectOpen(true)}>
                  {t("direct.newChat")}
                </Button>
              ) : null}
              <Button onClick={() => void onNewChat()}>
                <PlusIcon size={16} aria-hidden="true" />
                {t("chat.newChat")}
              </Button>
            </>
          }
        />
        {CONSUMER_FEATURES.directChats ? (
          <SegmentedControl label={t("direct.inbox")}>
            <Segment checked={tab === "all"} onSelect={() => setTab("all")}>
              {t("direct.tabAll")}
            </Segment>
            <Segment checked={tab === "ai"} onSelect={() => setTab("ai")}>
              {t("direct.tabAi")}
            </Segment>
            <Segment checked={tab === "direct"} onSelect={() => setTab("direct")}>
              {t("direct.tabDirect")}
            </Segment>
          </SegmentedControl>
        ) : null}
        <SearchInput
          aria-label={t("chat.search")}
          placeholder={t("chat.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {showAi ? (
          filteredAi.length === 0 && (!showDirect || filteredDirect.length === 0) ? (
            <EmptyState title={t("chat.empty")} />
          ) : (
            <div className={styles.list}>
              {filteredAi.map((conversation) => (
                <AIConversationRow
                  key={conversation.id}
                  title={conversation.title ?? t("chat.newChat")}
                  onSelect={() => router.push(`/app/${conversation.id}`)}
                />
              ))}
            </div>
          )
        ) : null}
        {showDirect ? (
          filteredDirect.length === 0 && tab === "direct" ? (
            <EmptyState title={t("direct.emptyList")} />
          ) : (
            <div className={styles.list}>
              {filteredDirect.map((item) => (
                <DirectConversationRow
                  key={item.id}
                  name={item.peer.name}
                  time={new Date(item.lastMessageAt).toLocaleString(locale)}
                  unreadCount={item.unreadCount}
                  onSelect={() => router.push(`/app/direct/${item.id}`)}
                />
              ))}
            </div>
          )
        ) : null}
      </div>
      <Dialog
        open={directOpen}
        onOpenChange={setDirectOpen}
        title={t("direct.newChat")}
        closeLabel={t("common.close")}
      >
        <form onSubmit={(event) => void onCreateDirect(event)}>
          {directError ? <Alert variant="error">{tx(t, apiErrorMessageKey(directError))}</Alert> : null}
          <FormField label={t("direct.peerEmail")} htmlFor="direct-peer-email">
            <Input
              id="direct-peer-email"
              type="email"
              value={peerEmail}
              onChange={(event) => setPeerEmail(event.target.value)}
              required
            />
          </FormField>
          <Button type="submit">{t("direct.start")}</Button>
        </form>
      </Dialog>
    </ConsumerShell>
  );
});
