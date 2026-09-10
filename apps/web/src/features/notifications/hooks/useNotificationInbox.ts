"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserNotificationView } from "@vimla/contracts";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/api";

const POLL_MS = 60_000;

export function useNotificationInbox() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<UserNotificationView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [listOpen, setListOpen] = useState(false);

  const refreshUnread = useCallback(async (): Promise<void> => {
    const result = await fetchUnreadCount();
    setUnread(result.count);
  }, []);

  const refreshList = useCallback(async (): Promise<void> => {
    setStatus("loading");
    try {
      const page = await fetchNotifications();
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setStatus("ready");
      const count = await fetchUnreadCount();
      setUnread(count.count);
    } catch {
      setStatus("error");
    }
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor) {
      return;
    }
    const page = await fetchNotifications({ cursor: nextCursor });
    setItems((current) => [...current, ...page.items]);
    setNextCursor(page.nextCursor);
  }, [nextCursor]);

  const markOne = useCallback(async (id: string): Promise<UserNotificationView> => {
    const previous = items.find((item) => item.id === id);
    const updated = await markNotificationRead(id);
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    if (!previous?.readAt && updated.readAt) {
      setUnread((count) => Math.max(0, count - 1));
    }
    return updated;
  }, [items]);

  const markAll = useCallback(async (): Promise<void> => {
    await markAllNotificationsRead();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnread(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshUnread()
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshUnread]);

  useEffect(() => {
    function onFocus(): void {
      void refreshUnread().catch(() => undefined);
    }
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        void refreshUnread().catch(() => undefined);
      }
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (document.visibilityState !== "visible") {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshUnread().catch(() => undefined);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUnread]);

  useEffect(() => {
    if (listOpen) {
      void refreshList().catch(() => undefined);
    }
  }, [listOpen, refreshList]);

  return {
    unread,
    items,
    nextCursor,
    status,
    listOpen,
    setListOpen,
    refreshList,
    loadMore,
    markOne,
    markAll,
  };
}
