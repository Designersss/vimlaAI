import {
  notificationPreferencesViewSchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
  userNotificationViewSchema,
  type NotificationPreferencesView,
  type NotificationsResponse,
  type UnreadCountResponse,
  type UpdateNotificationPreferences,
  type UserNotificationView,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export class NotificationApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NotificationApiError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error !== null &&
      typeof payload.error === "object" &&
      "code" in payload.error &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : "internal_error";
    throw new NotificationApiError(code);
  }
  return parse(payload);
}

export async function fetchNotifications(
  query: { cursor?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request(
    `/v1/notifications${suffix}`,
    {},
    (payload) => notificationsResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchUnreadCount(fetchImpl: typeof fetch = fetch): Promise<UnreadCountResponse> {
  return request(
    "/v1/notifications/unread-count",
    {},
    (payload) => unreadCountResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function markNotificationRead(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserNotificationView> {
  return request(
    `/v1/notifications/${id}/read`,
    { method: "PATCH" },
    (payload) => userNotificationViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function markAllNotificationsRead(fetchImpl: typeof fetch = fetch): Promise<UnreadCountResponse> {
  return request(
    "/v1/notifications/read-all",
    { method: "POST" },
    (payload) => unreadCountResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchNotificationPreferences(
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationPreferencesView> {
  return request(
    "/v1/notification-preferences",
    {},
    (payload) => notificationPreferencesViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferences,
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationPreferencesView> {
  return request(
    "/v1/notification-preferences",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    (payload) => notificationPreferencesViewSchema.parse(payload),
    fetchImpl,
  );
}
