"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "../../services/auth-client";
import { isValidEmail } from "../../services/validation";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import styles from "../AuthForm/AuthForm.module.scss";

export function ForgotPasswordForm(): ReactElement {
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [state, setState] = useState<"idle" | "submitting">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!isValidEmail(email)) {
      setFieldError(t("validation.email"));
      return;
    }
    if (state === "submitting") {
      return;
    }
    setFieldError(null);
    setState("submitting");
    const result = await authClient.requestPasswordReset({
      email,
    });
    setState("idle");
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return <p role="status">{t("auth.forgot.success")}</p>;
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <label className={styles.field} htmlFor="forgot-email">
        {t("auth.email")}
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? "forgot-email-error" : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        {fieldError ? (
          <span id="forgot-email-error" className={styles.fieldError}>
            {fieldError}
          </span>
        ) : null}
      </label>
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? t("auth.working") : t("auth.forgot.submit")}
      </button>
    </form>
  );
}
