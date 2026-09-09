"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, FormField, Input } from "@vimla/ui";
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
    return <Alert variant="success">{t("auth.forgot.success")}</Alert>;
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <FormField label={t("auth.email")} htmlFor="forgot-email" error={fieldError}>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          invalid={Boolean(fieldError)}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </FormField>
      {formError ? <Alert variant="error">{formError}</Alert> : null}
      <Button type="submit" disabled={state === "submitting"} loading={state === "submitting"} block>
        {t("auth.forgot.submit")}
      </Button>
    </form>
  );
}
