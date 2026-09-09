"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert, AuthCard, AuthLayout, Button, FormField, Heading, Input, PasswordInput, Text } from "@vimla/ui";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function EnrollPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  async function enableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const result = await adminAuthClient.twoFactor.enable({ password });
    if (result.error || !result.data) {
      setError(t("app.denied"));
      return;
    }
    if ("totpURI" in result.data && typeof result.data.totpURI === "string") {
      setTotpUri(result.data.totpURI);
    }
    if ("backupCodes" in result.data && Array.isArray(result.data.backupCodes)) {
      setBackupCodes(result.data.backupCodes.filter((item): item is string => typeof item === "string"));
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("totpCode") ?? "");
    const result = await adminAuthClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setError(t("app.denied"));
      return;
    }
    router.push("/elevate");
  }

  async function addPasskey() {
    const result = await adminAuthClient.passkey.addPasskey({ name: "Vimla Admin" });
    if (result?.error) {
      setError(t("app.denied"));
    }
  }

  return (
    <AuthLayout>
      <AuthCard>
        <Heading as="h1" size="page">
          {t("app.enroll")}
        </Heading>
        <form className={styles.form} onSubmit={(event) => void enableTotp(event)}>
          <FormField label={t("app.password")} htmlFor="enroll-password">
            <PasswordInput
              id="enroll-password"
              name="password"
              autoComplete="current-password"
              required
              revealLabel={t("app.revealPassword")}
              hideLabel={t("app.hidePassword")}
            />
          </FormField>
          <Button type="submit">{t("app.enroll")}</Button>
        </form>
        {totpUri ? (
          <Text>
            {t("app.totpUri")}: <code>{totpUri}</code>
          </Text>
        ) : null}
        {backupCodes ? (
          <section>
            <Text>{t("app.backupCodesOnce")}</Text>
            <pre>{backupCodes.join("\n")}</pre>
          </section>
        ) : null}
        <form className={styles.form} onSubmit={(event) => void verifyTotp(event)}>
          <FormField label={t("app.verifyTotp")} htmlFor="enroll-totp">
            <Input id="enroll-totp" name="totpCode" inputMode="numeric" required />
          </FormField>
          <Button type="submit">{t("app.verifyTotp")}</Button>
        </form>
        <Button type="button" variant="secondary" onClick={() => void addPasskey()}>
          {t("app.addPasskey")}
        </Button>
        {error ? <Alert variant="error">{error}</Alert> : null}
      </AuthCard>
    </AuthLayout>
  );
}
