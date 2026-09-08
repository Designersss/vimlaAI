"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
    return <p role="status">{t("auth.reset.success")}</p>;
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <label className={styles.field} htmlFor="reset-password">
        {t("auth.newPassword")}
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={password}
          minLength={8}
          aria-invalid={Boolean(fieldError)}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </label>
      <label className={styles.field} htmlFor="reset-confirm">
        {t("auth.confirmPassword")}
        <input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
        />
        {fieldError ? <span className={styles.fieldError}>{fieldError}</span> : null}
      </label>
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? t("auth.working") : t("auth.reset.submit")}
      </button>
    </form>
  );
}
