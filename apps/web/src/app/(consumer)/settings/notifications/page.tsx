import type { ReactElement } from "react";
import { NotificationSettings } from "../../../../features/notifications/components/NotificationSettings";
import { CONSUMER_FEATURES } from "../../../../shared/config/consumer-features";
import { notFound } from "next/navigation";

export default function NotificationsSettingsPage(): ReactElement {
  if (!CONSUMER_FEATURES.notificationsSettings) {
    notFound();
  }
  return <NotificationSettings />;
}
