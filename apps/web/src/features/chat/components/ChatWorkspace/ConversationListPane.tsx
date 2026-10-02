"use client";

import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type FormEvent,
  type ReactElement,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useLocale,
  useTranslations,
} from "next-intl";
import { observer } from "mobx-react-lite";
import type {
  CommunicationSurfaceKind,
} from "@vimla/contracts";
import {
  AIConversationRow,
  Alert,
  Button,
  Dialog,
  DirectConversationRow,
  EmptyState,
  ErrorState,
  FormField,
  Heading,
  Input,
  PageHeader,
  PlusIcon,
  SearchInput,
  Segment,
  SegmentedControl,
  Spinner,
} from "@vimla/ui";
import {
  AuthRequiredError,
  fetchCurrentUser,
} from "../../../auth/services/current-user";
import {
  createConversation,
} from "../../services/conversations";
import {
  fetchInbox,
  resolveWebInboxPreview,
} from "../../services/inbox";
import {
  useChatSyncHub,
  useChatWorkspace,
  usePrepareChatDevice,
} from "./ChatWorkspaceProvider";
import {
  CONSUMER_FEATURES,
} from "../../../../shared/config/consumer-features";
import {
  apiErrorMessageKey,
} from "../../../../shared/errors/error-keys";
import {
  tx,
} from "../../../../shared/i18n/translate";
import {
  DirectChatsApiError,
  createDirectConversation,
} from "../../../direct-chats/services/api";
import {
  subscribeWebSync,
} from "../../../../shared/sync/web-sync";
import styles from "./ChatWorkspace.module.scss";

type InboxTab = "all" | "ai" | "direct";

function inboxKindFor(
  tab: InboxTab,
): CommunicationSurfaceKind | undefined {
  if (!CONSUMER_FEATURES.directChats) {
    return "AI_THREAD";
  }
  if (tab === "ai") {
    return "AI_THREAD";
  }
  if (tab === "direct") {
    return "DIRECT";
  }
  return undefined;
}

export const ConversationListPane = observer(
  function ConversationListPane({
    aiId,
    directId,
  }: {
    aiId?: string;
    directId?: string;
  }): ReactElement {
    const t = useTranslations();
    const locale = useLocale();
    const router = useRouter();
    const store = useChatWorkspace();
    const syncHub = useChatSyncHub();
    const prepareDevice =
      usePrepareChatDevice();

    const [boot, setBoot] = useState<
      "loading" | "ready" | "failed"
    >("loading");
    const [query, setQuery] = useState("");
    const [tab, setTab] =
      useState<InboxTab>("all");
    const [directOpen, setDirectOpen] =
      useState(false);
    const [peerEmail, setPeerEmail] =
      useState("");
    const [directError, setDirectError] =
      useState<string | null>(null);
    const [listError, setListError] =
      useState(false);
    const [userId, setUserId] = useState<
      string | null
    >(null);
    const [attempt, setAttempt] =
      useState(0);
    const [creating, setCreating] =
      useState(false);
    const [loadingMore, setLoadingMore] =
      useState(false);
    const [createError, setCreateError] =
      useState(false);
    const [previews, setPreviews] =
      useState<Record<string, string | null>>(
        {},
      );

    const kind = inboxKindFor(tab);
    const normalizedQuery =
      query.trim() || undefined;
    const refreshRevision =
      store.inboxRefreshRevision;
    const inboxItems = store.inboxItems;
    const nextCursor = store.inboxNextCursor;

    useEffect(() => {
      let cancelled = false;

      void Promise.all([
        fetchCurrentUser(),
        fetchInbox({
          limit: 50,
          kind: inboxKindFor("all"),
        }),
      ])
        .then(async ([currentUser, page]) => {
          if (cancelled) {
            return;
          }
          if (CONSUMER_FEATURES.directChats) {
            await prepareDevice();
          }
          if (cancelled) {
            return;
          }
          setUserId(currentUser.id);
          store.setInboxPage(page);
          setBoot("ready");
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          if (
            error instanceof AuthRequiredError
          ) {
            router.replace("/sign-in");
            return;
          }
          setBoot("failed");
        });

      return () => {
        cancelled = true;
      };
    }, [
      attempt,
      prepareDevice,
      router,
      store,
    ]);

    useEffect(() => {
      if (boot !== "ready") {
        return;
      }

      let cancelled = false;
      const timer = window.setTimeout(() => {
        void fetchInbox({
          limit: 50,
          kind,
          q: normalizedQuery,
        })
          .then((page) => {
            if (cancelled) {
              return;
            }
            store.setInboxPage(page);
            setListError(false);
          })
          .catch((error: unknown) => {
            if (cancelled) {
              return;
            }
            if (
              error instanceof
              AuthRequiredError
            ) {
              router.replace("/sign-in");
              return;
            }
            setListError(true);
          });
      }, 150);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [
      boot,
      kind,
      normalizedQuery,
      refreshRevision,
      router,
      store,
    ]);

    useEffect(() => {
      let cancelled = false;

      void Promise.all(
        inboxItems.map(async (item) => [
          item.surfaceId,
          await resolveWebInboxPreview(item),
        ] as const),
      ).then((entries) => {
        if (!cancelled) {
          setPreviews(
            Object.fromEntries(entries),
          );
        }
      });

      return () => {
        cancelled = true;
      };
    }, [inboxItems]);

    useEffect(() => {
      if (
        boot !== "ready" ||
        !userId
      ) {
        return;
      }
      let cancelled = false;

      const unsubscribe = subscribeWebSync({
        userId,
        onAuthRequired: () => {
          router.replace("/sign-in");
        },
        onDeltas: async (deltas) => {
          if (cancelled) {
            return;
          }
          if (
            deltas.some(
              (delta) =>
                delta.scope.kind ===
                "DIRECT_CHAT",
            )
          ) {
            store.requestInboxRefresh();
          }
          if (!cancelled) {
            await syncHub.publish(deltas);
          }
        },
      });

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [
      boot,
      router,
      store,
      syncHub,
      userId,
    ]);

    async function onNewChat(): Promise<void> {
      if (creating) {
        return;
      }
      setCreating(true);
      setCreateError(false);
      try {
        const conversation =
          await createConversation();
        setQuery("");
        setTab("all");
        store.requestInboxRefresh();
        router.push(
          `/app/${conversation.id}`,
          { scroll: false },
        );
      } catch (error: unknown) {
        if (
          error instanceof AuthRequiredError
        ) {
          router.replace("/sign-in");
        } else {
          setCreateError(true);
        }
      } finally {
        setCreating(false);
      }
    }

    async function onCreateDirect(
      event: FormEvent,
    ): Promise<void> {
      event.preventDefault();
      setDirectError(null);
      try {
        await prepareDevice();
        const created =
          await createDirectConversation({
            peerEmail,
          });
        setDirectOpen(false);
        setPeerEmail("");
        setQuery("");
        setTab("all");
        store.requestInboxRefresh();
        router.push(
          `/app/direct/${created.id}`,
          { scroll: false },
        );
      } catch (caught: unknown) {
        setDirectError(
          caught instanceof
            DirectChatsApiError
            ? caught.code
            : "internal_error",
        );
      }
    }

    async function onLoadMore(): Promise<void> {
      if (!nextCursor || loadingMore) {
        return;
      }
      setLoadingMore(true);
      try {
        const page = await fetchInbox({
          limit: 50,
          cursor: nextCursor,
          kind,
          q: normalizedQuery,
        });
        store.setInboxPage(page, true);
        setListError(false);
      } catch (error: unknown) {
        if (
          error instanceof AuthRequiredError
        ) {
          router.replace("/sign-in");
        } else {
          setListError(true);
        }
      } finally {
        setLoadingMore(false);
      }
    }

    if (boot === "loading") {
      return (
        <p className={styles.status}>
          <Spinner
            label={t("chat.loading")}
          />
        </p>
      );
    }

    if (boot === "failed") {
      return (
        <ErrorState
          title={t("chat.failed")}
          action={
            <Button
              onClick={() => {
                setBoot("loading");
                setAttempt(
                  (value) => value + 1,
                );
              }}
            >
              {t("common.retry")}
            </Button>
          }
        />
      );
    }

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
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setDirectOpen(true)
                    }
                  >
                    {t("direct.newChat")}
                  </Button>
                ) : null}
                <Button
                  disabled={creating}
                  onClick={() =>
                    void onNewChat()
                  }
                >
                  <PlusIcon
                    size={16}
                    aria-hidden="true"
                  />
                  {t("chat.newChat")}
                </Button>
              </>
            }
          />

          {CONSUMER_FEATURES.directChats ? (
            <SegmentedControl
              label={t("direct.inbox")}
            >
              <Segment
                checked={tab === "all"}
                onSelect={() =>
                  setTab("all")
                }
              >
                {t("direct.tabAll")}
              </Segment>
              <Segment
                checked={tab === "ai"}
                onSelect={() =>
                  setTab("ai")
                }
              >
                {t("direct.tabAi")}
              </Segment>
              <Segment
                checked={tab === "direct"}
                onSelect={() =>
                  setTab("direct")
                }
              >
                {t("direct.tabDirect")}
              </Segment>
            </SegmentedControl>
          ) : null}

          {createError ? (
            <Alert variant="error">
              {t("chat.failed")}
            </Alert>
          ) : null}
          {listError ? (
            <Alert variant="error">
              {t("common.genericError")}
            </Alert>
          ) : null}

          <SearchInput
            aria-label={t("chat.search")}
            placeholder={t("chat.search")}
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
          />

          {inboxItems.length === 0 ? (
            <EmptyState
              title={
                tab === "direct"
                  ? t("direct.emptyList")
                  : t("chat.empty")
              }
            />
          ) : (
            <div className={styles.list}>
              {inboxItems.map((item) => {
                const localPreview =
                  previews[item.surfaceId];
                const preview =
                  localPreview ??
                  (item.surfaceKind ===
                    "DIRECT" &&
                  item.preview.kind ===
                    "E2EE_LOCAL"
                    ? t(
                        "direct.encryptedPreview",
                      )
                    : undefined);
                const time = new Date(
                  item.lastActivityAt,
                ).toLocaleString(locale);

                if (
                  item.surfaceKind ===
                  "AI_THREAD"
                ) {
                  return (
                    <AIConversationRow
                      key={item.surfaceId}
                      title={
                        item.title ??
                        t("chat.newChat")
                      }
                      preview={
                        preview ?? undefined
                      }
                      time={time}
                      unreadCount={
                        item.unreadCount
                      }
                      href={`/app/${item.domainId}`}
                      renderLink={
                        renderConversationLink
                      }
                      selected={
                        aiId ===
                        item.domainId
                      }
                    />
                  );
                }

                return (
                  <DirectConversationRow
                    key={item.surfaceId}
                    name={item.title}
                    preview={
                      preview ?? undefined
                    }
                    time={time}
                    unreadCount={
                      item.unreadCount
                    }
                    href={`/app/direct/${item.domainId}`}
                    renderLink={
                      renderConversationLink
                    }
                    selected={
                      directId ===
                      item.domainId
                    }
                  />
                );
              })}
            </div>
          )}

          {nextCursor ? (
            <Button
              variant="ghost"
              disabled={loadingMore}
              onClick={() =>
                void onLoadMore()
              }
            >
              {t("chat.loadMore")}
            </Button>
          ) : null}
        </div>

        <Dialog
          open={directOpen}
          onOpenChange={setDirectOpen}
          title={t("direct.newChat")}
          closeLabel={t("common.close")}
        >
          <form
            onSubmit={(event) =>
              void onCreateDirect(event)
            }
          >
            {directError ? (
              <Alert variant="error">
                {tx(
                  t,
                  apiErrorMessageKey(
                    directError,
                  ),
                )}
              </Alert>
            ) : null}
            <FormField
              label={t("direct.peerEmail")}
              htmlFor="direct-peer-email"
            >
              <Input
                id="direct-peer-email"
                type="email"
                value={peerEmail}
                onChange={(event) =>
                  setPeerEmail(
                    event.target.value,
                  )
                }
                required
              />
            </FormField>
            <Button type="submit">
              {t("direct.start")}
            </Button>
          </form>
        </Dialog>
      </>
    );
  },
);

function renderConversationLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  },
): ReactElement {
  return (
    <Link {...props} scroll={false} />
  );
}
