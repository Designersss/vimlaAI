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
import {
  ClientApiError,
  jsonRequestInit,
  queryString,
  type ClientTransport,
} from "./transport.js";

export class NotificationApiError extends ClientApiError {
  constructor(code: string, status: number) {
    super(code, status);
    this.name = "NotificationApiError";
  }
}

export function createNotificationsClient(
  transport: ClientTransport,
) {
  const errorFactory = (code: string, status: number) =>
    new NotificationApiError(code, status);

  return {
    fetchNotifications(
      query: { cursor?: string; limit?: number } = {},
    ): Promise<NotificationsResponse> {
      return transport.request(
        `/v1/notifications${queryString([
          ["cursor", query.cursor],
          ["limit", query.limit],
        ])}`,
        {
          parse: (payload) => notificationsResponseSchema.parse(payload),
          errorFactory,
        },
      );
    },

    fetchUnreadCount(): Promise<UnreadCountResponse> {
      return transport.request("/v1/notifications/unread-count", {
        parse: (payload) => unreadCountResponseSchema.parse(payload),
        errorFactory,
      });
    },

    markNotificationRead(id: string): Promise<UserNotificationView> {
      return transport.request(
        `/v1/notifications/${encodeURIComponent(id)}/read`,
        {
          init: { method: "PATCH" },
          parse: (payload) => userNotificationViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    markAllNotificationsRead(): Promise<UnreadCountResponse> {
      return transport.request("/v1/notifications/read-all", {
        init: { method: "POST" },
        parse: (payload) => unreadCountResponseSchema.parse(payload),
        errorFactory,
      });
    },

    fetchNotificationPreferences(): Promise<NotificationPreferencesView> {
      return transport.request("/v1/notification-preferences", {
        parse: (payload) =>
          notificationPreferencesViewSchema.parse(payload),
        errorFactory,
      });
    },

    updateNotificationPreferences(
      input: UpdateNotificationPreferences,
    ): Promise<NotificationPreferencesView> {
      return transport.request("/v1/notification-preferences", {
        init: jsonRequestInit("PATCH", input),
        parse: (payload) =>
          notificationPreferencesViewSchema.parse(payload),
        errorFactory,
      });
    },
  };
}
