"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, FormField, PasswordInput } from "@vimla/ui";
import { authClient } from "../../services/auth-client";
import { passwordTooShort } from "../../services/validation";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import styles from "../AuthForm/AuthForm.module.scss";

export function ResetPasswordForm(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [state, setState] = useState<"idle" | "submitting">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (passwordTooShort(password) || password.length === 0) {
      setFieldError(t("validation.passwordMin"));
      return;
    }
    if (password !== confirm) {
      setFieldError(t("validation.passwordMismatch"));
      return;
    }
    if (!token) {
      setFormError(t("auth.errors.invalidResetToken"));
      return;
    }
    if (state === "submitting") {
      return;
    }
    setFieldError(null);
    setState("submitting");
    const result = await authClient.resetPassword({ newPassword: password, token });
    setState("idle");
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setSuccess(true);
    window.setTimeout(() => {
      router.push("/sign-in");
    }, 1500);
  }

  if (success) {
    return <Alert variant="success">{t("auth.reset.success")}</Alert>;
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <FormField label={t("auth.newPassword")} htmlFor="reset-password" error={fieldError}>
        <PasswordInput
          id="reset-password"
          autoComplete="new-password"
          value={password}
          minLength={8}
          invalid={Boolean(fieldError)}
          revealLabel={t("auth.revealPassword")}
          hideLabel={t("auth.hidePassword")}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </FormField>
      <FormField label={t("auth.confirmPassword")} htmlFor="reset-confirm">
        <PasswordInput
          id="reset-confirm"
          autoComplete="new-password"
          value={confirm}
          revealLabel={t("auth.revealPassword")}
          hideLabel={t("auth.hidePassword")}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
        />
      </FormField>
      {formError ? <Alert variant="error">{formError}</Alert> : null}
      <Button type="submit" disabled={state === "submitting"} loading={state === "submitting"} block>
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}
