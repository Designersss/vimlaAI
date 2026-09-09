"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert, AuthCard, AuthLayout, Button, FormField, Heading, Input } from "@vimla/ui";
import { adminFetch } from "../../shared/api/admin-fetch";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function ElevatePage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const totpCode = String(form.get("totpCode") ?? "");
    const backupCode = String(form.get("backupCode") ?? "");
    if (!totpCode && !backupCode) {
      setError(t("app.denied"));
      return;
    }
    if (totpCode) {
      await adminAuthClient.twoFactor.verifyTotp({ code: totpCode });
    } else if (backupCode) {
      await adminAuthClient.twoFactor.verifyBackupCode({ code: backupCode });
    }
    const response = await adminFetch("/admin/v1/auth/elevate", {
      method: "POST",
      body: JSON.stringify(totpCode ? { totpCode } : { backupCode }),
    });
    if (!response.ok) {
      setError(t("app.denied"));
      return;
    }
    router.push("/admin");
  }

  return (
    <AuthLayout>
      <AuthCard>
        <Heading as="h1" size="page">
          {t("app.elevate")}
        </Heading>
        <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
          <FormField label={t("app.verifyTotp")} htmlFor="elevate-totp">
            <Input id="elevate-totp" name="totpCode" inputMode="numeric" autoComplete="one-time-code" />
          </FormField>
          <FormField label={t("app.backupCode")} htmlFor="elevate-backup">
            <Input id="elevate-backup" name="backupCode" autoComplete="off" />
          </FormField>
          <Button type="submit">{t("app.elevate")}</Button>
          {error ? <Alert variant="error">{error}</Alert> : null}
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
