"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { NotificationPreferencesView } from "@vimla/contracts";
import { Alert, Card, Heading, Switch, Text } from "@vimla/ui";
import { AuthRequiredError } from "../../auth/services/current-user";
import { SettingsChrome } from "../../settings/components/SettingsChrome/SettingsChrome";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "../services/api";
import styles from "./Notifications.module.scss";

export function NotificationSettings(): ReactElement {
  const t = useTranslations();
  const [prefs, setPrefs] = useState<NotificationPreferencesView | null>(null);
  const [message, setMessage] = useState<"saved" | "error" | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchNotificationPreferences()
      .then((value) => {
        if (!cancelled) {
          setPrefs(value);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          return;
        }
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(patch: { reminderInAppEnabled?: boolean; reminderEmailEnabled?: boolean }): Promise<void> {
    setMessage(null);
    try {
      const next = await updateNotificationPreferences(patch);
      setPrefs(next);
      setMessage("saved");
    } catch {
      setMessage("error");
    }
  }

  return (
    <SettingsChrome title={t("notifications.settingsTitle")}>
      {status === "error" ? <Alert variant="error">{t("common.genericError")}</Alert> : null}
      <Card>
        <Heading as="h2" size="section">
          {t("notifications.remindersSection")}
        </Heading>
        <Text tone="secondary">{t("notifications.remindersDescription")}</Text>
        <div className={styles.prefRow}>
          <Switch
            label={t("notifications.inApp")}
            checked={prefs?.reminderInAppEnabled ?? true}
            disabled={!prefs}
            onChange={(event) => void update({ reminderInAppEnabled: event.currentTarget.checked })}
          />
        </div>
        <div className={styles.prefRow}>
          <Switch
            label={t("notifications.email")}
            checked={prefs?.reminderEmailEnabled ?? false}
            disabled={!prefs || !prefs.emailAddressAvailable}
            onChange={(event) => void update({ reminderEmailEnabled: event.currentTarget.checked })}
          />
        </div>
        {prefs && !prefs.emailAddressAvailable ? (
          <Alert variant="info">
            {t("notifications.emailUnverified")}{" "}
            <Link href="/verify-email">{t("notifications.verifyEmail")}</Link>
          </Alert>
        ) : null}
        {message === "saved" ? <Alert variant="success">{t("notifications.saved")}</Alert> : null}
        {message === "error" ? <Alert variant="error">{t("common.genericError")}</Alert> : null}
      </Card>
    </SettingsChrome>
  );
}
