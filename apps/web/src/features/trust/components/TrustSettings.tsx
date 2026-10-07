"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BlockedUser } from "@vimla/contracts";
import {
  Alert,
  Avatar,
  Button,
  Card,
  EmptyState,
  Heading,
  Spinner,
  Text,
} from "@vimla/ui";
import { SettingsChrome } from "../../settings/components/SettingsChrome/SettingsChrome";
import {
  AuthRequiredError,
  TrustApiError,
  listBlockedUsers,
  unblockUser,
} from "../services/api";
import styles from "./Trust.module.scss";

export function TrustSettings(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyHandle, setBusyHandle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listBlockedUsers({ limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, router]);

  async function loadMore(): Promise<void> {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listBlockedUsers({ cursor, limit: 50 });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.userId));
        return [...current, ...page.items.filter((item) => !seen.has(item.userId))];
      });
      setCursor(page.nextCursor);
      setStatus("ready");
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function unblock(handle: string): Promise<void> {
    if (busyHandle) return;
    setBusyHandle(handle);
    try {
      await unblockUser(handle);
      setItems((current) => current.filter((item) => item.handle !== handle));
      setStatus("ready");
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      if (
        error instanceof TrustApiError &&
        error.code === "not_found"
      ) {
        setItems((current) =>
          current.filter((item) => item.handle !== handle),
        );
        setStatus("ready");
        return;
      }
      setStatus("error");
    } finally {
      setBusyHandle(null);
    }
  }

  function retryLoad(): void {
    if (status === "loading") return;
    setStatus("loading");
    setAttempt((value) => value + 1);
  }

  return (
    <SettingsChrome title={t("settings.safetyTitle")}>
      {status === "error" ? (
        <Alert variant="error">{t("common.genericError")}</Alert>
      ) : null}
      <Card>
        <Heading as="h2" size="section">{t("trust.blockedUsers")}</Heading>
        <Text tone="secondary">{t("trust.blockedUsersDescription")}</Text>
        {status === "loading" ? (
          <Spinner label={t("common.loading")} />
        ) : items.length === 0 ? (
          status === "error" ? (
            <Button variant="ghost" onClick={retryLoad}>
              {t("common.retry")}
            </Button>
          ) : (
            <EmptyState title={t("trust.noBlockedUsers")} />
          )
        ) : (
          <div className={styles.blockedList}>
            {items.map((item) => (
              <div
                key={item.userId}
                className={styles.blockedRow}
                data-testid="blocked-user-row"
              >
                <div className={styles.blockedIdentity}>
                  <Avatar name={item.displayName} src={item.avatarUrl} />
                  <div className={styles.blockedText}>
                    <strong>{item.displayName}</strong>
                    <Text tone="secondary">@{item.handle}</Text>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  disabled={busyHandle !== null}
                  onClick={() => void unblock(item.handle)}
                >
                  {t("trust.unblock")}
                </Button>
              </div>
            ))}
            {cursor ? (
              <Button
                variant="ghost"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {t("trust.loadMore")}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </SettingsChrome>
  );
}
