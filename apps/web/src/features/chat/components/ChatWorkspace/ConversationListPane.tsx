"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useState, type AnchorHTMLAttributes, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { AuthRequiredError } from "../../../auth/services/current-user";
import { fetchConversations, createConversation } from "../../services/conversations";
import { useChatWorkspace, usePrepareChatDevice } from "./ChatWorkspaceProvider";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { apiErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import {
  DirectChatsApiError,
  createDirectConversation,
  fetchDirectConversations,
} from "../../../direct-chats/services/api";
import styles from "./ChatWorkspace.module.scss";

type InboxTab = "all" | "ai" | "direct";

export const ConversationListPane = observer(function ConversationListPane({ aiId, directId }: { aiId?: string; directId?: string }): ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const store = useChatWorkspace();
  const prepareDevice = usePrepareChatDevice();
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [directOpen, setDirectOpen] = useState(false);
  const [peerEmail, setPeerEmail] = useState("");
  const [directError, setDirectError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchConversations(),
      CONSUMER_FEATURES.directChats ? fetchDirectConversations() : Promise.resolve({ items: [], nextCursor: null }),
    ])
      .then(async ([conversations, directPage]) => {
        if (cancelled) return;
        if (CONSUMER_FEATURES.directChats) await prepareDevice();
        if (cancelled) return;
        store.setConversations(conversations);
        store.hydrateDirectConversations(directPage.items);
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
  }, [attempt, prepareDevice, router, store]);

  async function onNewChat(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setCreateError(false);
    try {
      const conversation = await createConversation();
      store.addConversation(conversation);
      setQuery("");
      setTab("all");
      router.push(`/app/${conversation.id}`, { scroll: false });
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) router.replace("/sign-in");
      else setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  async function onCreateDirect(event: FormEvent): Promise<void> {
    event.preventDefault();
    setDirectError(null);
    try {
      await prepareDevice();
      const created = await createDirectConversation({ peerEmail });
      setDirectOpen(false);
      setPeerEmail("");
      store.updateDirectConversation(created);
      setQuery("");
      setTab("all");
      router.push(`/app/direct/${created.id}`, { scroll: false });
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
    return <ErrorState title={t("chat.failed")} action={<Button onClick={() => { setBoot("loading"); setAttempt((value) => value + 1); }}>{t("common.retry")}</Button>} />;
  }

  const filteredAi = store.conversations.filter((conversation) => {
    const title = conversation.title ?? t("chat.newChat");
    return title.toLowerCase().includes(query.trim().toLowerCase());
  });
  const filteredDirect = store.directConversations.filter((item) =>
    item.peer.name.toLowerCase().includes(query.trim().toLowerCase()) ||
    item.peer.email.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const showAi = !CONSUMER_FEATURES.directChats || tab === "all" || tab === "ai";
  const showDirect = CONSUMER_FEATURES.directChats && (tab === "all" || tab === "direct");

  return (
    <>
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
              <Button disabled={creating} onClick={() => void onNewChat()}>
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
        {createError ? <Alert variant="error">{t("chat.failed")}</Alert> : null}
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
                  href={`/app/${conversation.id}`}
                  renderLink={renderConversationLink}
                  selected={aiId === conversation.id}
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
                  href={`/app/direct/${item.id}`}
                  renderLink={renderConversationLink}
                  selected={directId === item.id}
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
    </>
  );
});

function renderConversationLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactElement {
  return <Link {...props} scroll={false} />;
}
