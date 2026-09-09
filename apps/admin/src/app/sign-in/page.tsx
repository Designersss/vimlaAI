"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert, AuthCard, AuthLayout, Button, FormField, Heading, Input, PasswordInput } from "@vimla/ui";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "../admin/admin.module.scss";

export default function SignInPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const result = await adminAuthClient.signIn.email({ email, password });
    if (result.error) {
      setError(t("errors.unauthorized"));
      return;
    }
    const session = await adminAuthClient.getSession();
    const twoFactorEnabled =
      session.data?.user && "twoFactorEnabled" in session.data.user
        ? session.data.user.twoFactorEnabled === true
        : false;
    router.push(twoFactorEnabled ? "/elevate" : "/enroll");
  }

  return (
    <AuthLayout>
      <AuthCard>
        <Heading as="h1" size="page">
          {t("app.signIn")}
        </Heading>
        <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
          <FormField label={t("app.email")} htmlFor="admin-email">
            <Input id="admin-email" name="email" type="email" autoComplete="username" required />
          </FormField>
          <FormField label={t("app.password")} htmlFor="admin-password">
            <PasswordInput
              id="admin-password"
              name="password"
              autoComplete="current-password"
              required
              revealLabel={t("app.revealPassword")}
              hideLabel={t("app.hidePassword")}
            />
          </FormField>
          <Button type="submit">{t("app.signIn")}</Button>
          {error ? <Alert variant="error">{error}</Alert> : null}
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
