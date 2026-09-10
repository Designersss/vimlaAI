"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactElement } from "react";
import {
  BellIcon,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  Spinner,
  Text,
} from "@vimla/ui";
import { formatDateTime } from "../../workspace/services/datetime";
import { useNotificationInbox } from "../hooks/useNotificationInbox";
import styles from "./Notifications.module.scss";

export function NotificationBell(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const inbox = useNotificationInbox();
  const label =
    inbox.unread > 0 ? t("notifications.unreadCount", { count: inbox.unread }) : t("notifications.open");

  async function onOpenItem(id: string, hrefPath: string | null): Promise<void> {
    const updated = await inbox.markOne(id);
    inbox.setListOpen(false);
    if (updated.hrefPath ?? hrefPath) {
      router.push(updated.hrefPath ?? hrefPath ?? "/work/reminders");
    }
  }

  return (
    <>
      <span className={styles.bellWrap}>
        <IconButton
          label={label}
          onClick={() => inbox.setListOpen(true)}
          data-testid="notification-bell"
        >
          <BellIcon size={18} />
        </IconButton>
        {inbox.unread > 0 ? <span className={styles.dot} data-testid="notification-unread-dot" /> : null}
      </span>
      <Drawer
        open={inbox.listOpen}
        onOpenChange={inbox.setListOpen}
        title={t("notifications.title")}
        closeLabel={t("common.close")}
        side="right"
      >
        <div className={styles.panel}>
          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void inbox.markAll()}
              disabled={inbox.unread === 0}
            >
              {t("notifications.markAllRead")}
            </Button>
          </div>
          {inbox.status === "loading" ? <Spinner label={t("common.loading")} /> : null}
          {inbox.status === "error" ? (
            <ErrorState
              title={t("notifications.failed")}
              action={
                <Button variant="secondary" size="sm" onClick={() => void inbox.refreshList()}>
                  {t("common.continue")}
                </Button>
              }
            />
          ) : null}
          {inbox.status === "ready" && inbox.items.length === 0 ? (
            <EmptyState title={t("notifications.empty")} />
          ) : null}
          {inbox.items.length > 0 ? (
            <div className={styles.list}>
              {inbox.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.row} ${item.readAt ? "" : styles.unreadRow}`.trim()}
                  data-testid="notification-item"
                  onClick={() => void onOpenItem(item.id, item.hrefPath)}
                >
                  <span className={styles.rowBody}>
                    <span className={styles.title}>{item.title}</span>
                    <Text as="span" className={styles.meta}>
                      {t("notifications.reminderDue")}
                      {item.body ? ` · ${item.body}` : ""}
                      {` · ${formatDateTime(item.createdAt)}`}
                      {item.sourceAvailable ? "" : ` · ${t("notifications.sourceUnavailable")}`}
                    </Text>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {inbox.nextCursor ? (
            <Button variant="secondary" size="sm" onClick={() => void inbox.loadMore()}>
              {t("notifications.loadMore")}
            </Button>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
