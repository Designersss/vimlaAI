"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import { Alert, Card, ErrorState, Spinner, Text, buttonClassName } from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../../auth/services/current-user";
import styles from "../../../auth/components/SecuritySettings/SecuritySettings.module.scss";

export function AccountSettings(): ReactElement {
  const t = useTranslations();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((current) => {
        if (!cancelled) {
          setUser(current);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled && !(caught instanceof AuthRequiredError)) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorState title={t("common.genericError")} />;
  }

  if (!user) {
    return <Spinner label={t("common.loading")} />;
  }

  return (
    <div className={styles.stack}>
      <Card>
        <Text>
          {t("auth.name")}: {user.name}
        </Text>
        <Text>
          {t("auth.email")}: {user.email} ({user.emailVerified ? t("settings.verified") : t("settings.unverified")})
        </Text>
        <Text tone="secondary">
          {t("settings.phone")}: {user.phoneNumber ?? t("settings.notLinked")}
        </Text>
        <Alert>{t("settings.accountHint")}</Alert>
        <Link href="/settings/security" className={buttonClassName({ variant: "secondary", size: "sm" })}>
          {t("nav.security")}
        </Link>
      </Card>
    </div>
  );
}
