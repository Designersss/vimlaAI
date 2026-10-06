"use client";

import { useEffect, useState, type ReactElement } from "react";
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
import { listBlockedUsers, unblockUser } from "../services/api";
import styles from "./Trust.module.scss";

export function TrustSettings(): ReactElement {
  const t = useTranslations();
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
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
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    } catch {
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
    } catch {
      setStatus("error");
    } finally {
      setBusyHandle(null);
    }
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
          <EmptyState title={t("trust.noBlockedUsers")} />
        ) : (
          <div className={styles.blockedList}>
            {items.map((item) => (
              <div key={item.userId} className={styles.blockedRow}>
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
