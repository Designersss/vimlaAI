"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
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
import { navigationTargetToWebPath } from "@vimla/web-navigation";
import type {
  CommunicationSurfaceKind,
  InboxItem,
} from "@vimla/contracts";
import type { PublicProfile } from "@vimla/contracts/public-profiles";
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
import { searchPeople } from "../../services/people";
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
    const [peerQuery, setPeerQuery] =
      useState("");
    const [selectedPeer, setSelectedPeer] =
      useState<PublicProfile | null>(null);
    const [peopleResults, setPeopleResults] =
      useState<PublicProfile[]>([]);
    const [peopleLoading, setPeopleLoading] =
      useState(false);
    const [peopleError, setPeopleError] =
      useState(false);
    const [directCreating, setDirectCreating] =
      useState(false);
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
      useState<
        Record<
          string,
          {
            descriptorKey: string | null;
            text: string | null;
          }
        >
      >({});

    const kind = inboxKindFor(tab);
    const normalizedQuery =
      query.trim() || undefined;
    const refreshRevision =
      store.inboxRefreshRevision;
    const inboxItems = store.inboxItems;
    const nextCursor = store.inboxNextCursor;
    const inboxRequestKey = JSON.stringify([
      kind ?? null,
      normalizedQuery ?? null,
      refreshRevision,
    ]);
    const inboxRequestKeyRef =
      useRef(inboxRequestKey);

    useLayoutEffect(() => {
      inboxRequestKeyRef.current =
        inboxRequestKey;
    }, [inboxRequestKey]);

    useEffect(() => {
      let cancelled = false;
      const bootRefreshRevision =
        store.inboxRefreshRevision;

      void Promise.all([
        fetchCurrentUser(),
        fetchInbox({
          limit: 50,
          kind: inboxKindFor("all"),
        }),
      ])
        .then(([currentUser, page]) => {
          if (cancelled) {
            return;
          }
          setUserId(currentUser.id);
          if (
            store.inboxRefreshRevision ===
            bootRefreshRevision
          ) {
            store.setInboxPage(page);
          }
          setBoot("ready");

          if (CONSUMER_FEATURES.directChats) {
            void prepareDevice().catch(
              (error: unknown) => {
                if (
                  cancelled ||
                  !(error instanceof AuthRequiredError)
                ) {
                  return;
                }
                router.replace("/sign-in");
              },
            );
          }
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
      const requestKey = inboxRequestKey;
      const requestRefreshRevision =
        refreshRevision;
      const timer = window.setTimeout(() => {
        void fetchInbox({
          limit: 50,
          kind,
          q: normalizedQuery,
        })
          .then((page) => {
            if (
              cancelled ||
              requestKey !==
                inboxRequestKeyRef.current ||
              store.inboxRefreshRevision !==
                requestRefreshRevision
            ) {
              return;
            }
            store.setInboxPage(page);
            setListError(false);
          })
          .catch((error: unknown) => {
            if (
              cancelled ||
              requestKey !==
                inboxRequestKeyRef.current ||
              store.inboxRefreshRevision !==
                requestRefreshRevision
            ) {
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
      inboxRequestKey,
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
          {
            descriptorKey:
              inboxPreviewDescriptorKey(item),
            text: await resolveWebInboxPreview(
              item,
            ),
          },
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

    useEffect(() => {
      if (!directOpen) {
        setPeopleResults([]);
        setPeopleLoading(false);
        setPeopleError(false);
        return;
      }

      const value = peerQuery.trim();
      const selectedValue = selectedPeer
        ? `@${selectedPeer.handle}`
        : null;
      if (
        value.length === 0 ||
        value === "@" ||
        value === selectedValue
      ) {
        setPeopleResults([]);
        setPeopleLoading(false);
        setPeopleError(false);
        return;
      }

      let cancelled = false;
      setPeopleLoading(true);
      setPeopleError(false);
      const timer = window.setTimeout(() => {
        void searchPeople(value)
          .then((response) => {
            if (cancelled) {
              return;
            }
            setPeopleResults(
              response.items.filter(
                (profile) =>
                  profile.userId !== userId,
              ),
            );
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
            setPeopleResults([]);
            setPeopleError(true);
          })
          .finally(() => {
            if (!cancelled) {
              setPeopleLoading(false);
            }
          });
      }, 200);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [
      directOpen,
      peerQuery,
      router,
      selectedPeer,
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
          navigationTargetToWebPath({
            version: 1,
            kind: "CHAT",
            id: conversation.surfaceId,
          }),
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

    function openDirectDialog(): void {
      setPeerQuery("");
      setSelectedPeer(null);
      setPeopleResults([]);
      setPeopleError(false);
      setDirectError(null);
      setDirectOpen(true);
    }

    function choosePeer(profile: PublicProfile): void {
      setSelectedPeer(profile);
      setPeerQuery(`@${profile.handle}`);
      setPeopleResults([]);
      setPeopleError(false);
      setDirectError(null);
    }

    async function onCreateDirect(
      event: FormEvent,
    ): Promise<void> {
      event.preventDefault();
      const peer = selectedPeer;
      if (directCreating || !peer) {
        return;
      }
      setDirectCreating(true);
      setDirectError(null);
      try {
        await prepareDevice();
        const created =
          await createDirectConversation({
            peerHandle: peer.handle,
          });
        setDirectOpen(false);
        setPeerQuery("");
        setSelectedPeer(null);
        setPeopleResults([]);
        setQuery("");
        setTab("all");
        store.requestInboxRefresh();
        router.push(
          navigationTargetToWebPath({
            version: 1,
            kind: "CHAT",
            id: created.surfaceId,
          }),
          { scroll: false },
        );
      } catch (caught: unknown) {
        if (caught instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setDirectError(
          caught instanceof
            DirectChatsApiError
            ? caught.code
            : "internal_error",
        );
      } finally {
        setDirectCreating(false);
      }
    }

    async function onLoadMore(): Promise<void> {
      if (!nextCursor || loadingMore) {
        return;
      }
      const cursor = nextCursor;
      const requestKey = inboxRequestKey;
      const requestRefreshRevision =
        refreshRevision;
      setLoadingMore(true);
      try {
        const page = await fetchInbox({
          limit: 50,
          cursor,
          kind,
          q: normalizedQuery,
        });
        if (
          requestKey !==
            inboxRequestKeyRef.current ||
          store.inboxRefreshRevision !==
            requestRefreshRevision ||
          store.inboxNextCursor !== cursor
        ) {
          return;
        }
        store.setInboxPage(page, true);
        setListError(false);
      } catch (error: unknown) {
        if (
          error instanceof AuthRequiredError
        ) {
          router.replace("/sign-in");
        } else if (
          requestKey ===
            inboxRequestKeyRef.current &&
          store.inboxRefreshRevision ===
            requestRefreshRevision &&
          store.inboxNextCursor === cursor
        ) {
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
                    onClick={openDirectDialog}
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
            <div className={styles.list} data-testid="unified-inbox-list">
              {inboxItems.map((item) => {
                const resolvedPreview =
                  previews[item.surfaceId];
                const descriptorKey =
                  inboxPreviewDescriptorKey(item);
                const localPreview =
                  resolvedPreview?.descriptorKey ===
                  descriptorKey
                    ? resolvedPreview.text
                    : null;
                const preview =
                  item.surfaceKind ===
                    "AI_THREAD"
                    ? item.preview.kind ===
                      "SERVER_TEXT"
                      ? item.preview.text
                      : undefined
                    : localPreview ??
                      (item.preview.kind ===
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
                      href={navigationTargetToWebPath(
                        item.navigationTarget,
                      )}
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
                    preview={`@${item.peer.handle}${preview ? ` · ${preview}` : ""}`}
                    time={time}
                    unreadCount={
                      item.unreadCount
                    }
                    href={navigationTargetToWebPath(
                      item.navigationTarget,
                    )}
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
              label={t("direct.newChat")}
              htmlFor="direct-peer-search"
            >
              <Input
                id="direct-peer-search"
                type="search"
                value={peerQuery}
                placeholder="@handle"
                autoComplete="off"
                onChange={(event) => {
                  setPeerQuery(
                    event.target.value,
                  );
                  setSelectedPeer(null);
                  setDirectError(null);
                }}
                required
              />
            </FormField>

            {peopleLoading ? (
              <p className={styles.peopleStatus}>
                <Spinner
                  label={t("common.loading")}
                />
              </p>
            ) : null}
            {peopleError ? (
              <Alert variant="error">
                {t("common.genericError")}
              </Alert>
            ) : null}
            {!peopleLoading &&
            !peopleError &&
            peerQuery.trim().length > 0 &&
            peerQuery.trim() !== "@" &&
            !selectedPeer &&
            peopleResults.length === 0 ? (
              <p className={styles.peopleStatus}>
                {t("errors.not_found")}
              </p>
            ) : null}
            {peopleResults.length > 0 ? (
              <div
                className={styles.peopleResults}
                data-testid="people-search-results"
              >
                {peopleResults.map((profile) => (
                  <Button
                    key={profile.userId}
                    type="button"
                    variant="ghost"
                    className={styles.peopleOption}
                    onClick={() =>
                      choosePeer(profile)
                    }
                  >
                    <span
                      className={
                        styles.peopleIdentity
                      }
                    >
                      <span>
                        {profile.displayName}
                      </span>
                      <span
                        className={
                          styles.peopleHandle
                        }
                      >
                        @{profile.handle}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {selectedPeer ? (
              <p className={styles.peopleStatus}>
                {selectedPeer.displayName} · @{selectedPeer.handle}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={
                directCreating ||
                selectedPeer === null
              }
            >
              {t("direct.start")}
            </Button>
          </form>
        </Dialog>
      </>
    );
  },
);

function inboxPreviewDescriptorKey(
  item: InboxItem,
): string | null {
  if (
    item.surfaceKind !== "DIRECT" ||
    item.preview.kind !== "E2EE_LOCAL"
  ) {
    return null;
  }

  return [
    item.preview.messageId,
    item.preview.senderUserId,
    item.preview.messageKind,
    item.preview.createdAt,
  ].join("\u0000");
}

function renderConversationLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  },
): ReactElement {
  return (
    <Link {...props} scroll={false} />
  );
}
