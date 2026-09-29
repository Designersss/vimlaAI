import type {
  NotificationPreferencesView,
  NotificationsResponse,
  UnreadCountResponse,
  UpdateNotificationPreferences,
  UserNotificationView,
} from "@vimla/contracts";
import { NotificationApiError } from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

export { NotificationApiError };

export async function fetchNotifications(
  query: { cursor?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationsResponse> {
  return createWebClientApi(fetchImpl).notifications.fetchNotifications(query);
}

export async function fetchUnreadCount(
  fetchImpl: typeof fetch = fetch,
): Promise<UnreadCountResponse> {
  return createWebClientApi(fetchImpl).notifications.fetchUnreadCount();
}

export async function markNotificationRead(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserNotificationView> {
  return createWebClientApi(fetchImpl).notifications.markNotificationRead(id);
}

export async function markAllNotificationsRead(
  fetchImpl: typeof fetch = fetch,
): Promise<UnreadCountResponse> {
  return createWebClientApi(fetchImpl).notifications.markAllNotificationsRead();
}

export async function fetchNotificationPreferences(
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationPreferencesView> {
  return createWebClientApi(fetchImpl).notifications.fetchNotificationPreferences();
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferences,
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationPreferencesView> {
  return createWebClientApi(fetchImpl).notifications.updateNotificationPreferences(input);
}
