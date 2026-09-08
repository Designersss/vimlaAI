"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "../../services/auth-client";
import { fetchCurrentUser } from "../../services/current-user";
import { isValidEmail, passwordTooShort } from "../../services/validation";
import {
  authErrorMessageKey,
  authRetryAfterSeconds,
  isAuthRateLimitError,
} from "../../../../shared/errors/error-keys";
import { syncAuthenticatedLocale } from "../../../../shared/i18n/persist-locale";
import { tx } from "../../../../shared/i18n/translate";
import styles from "./AuthForm.module.scss";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
}

export function AuthForm({ mode }: AuthFormProps): ReactElement {
  const router = useRouter();
  const t = useTranslations();
  const submittingRef = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting">("idle");
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (retryAfter <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setRetryAfter((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [retryAfter]);

  function validate(): boolean {
    const next: { name?: string; email?: string; password?: string } = {};
    if (mode === "sign-up" && name.trim().length === 0) {
      next.name = t("validation.nameMin");
    }
    if (!isValidEmail(email)) {
      next.email = t("validation.email");
    }
    if (password.length === 0) {
      next.password = t("validation.required");
    } else if (passwordTooShort(password)) {
      next.password = t("validation.passwordMin");
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current || retryAfter > 0) {
      return;
    }
    setFormError(null);
    if (!validate()) {
      const firstInvalid = document.querySelector<HTMLInputElement>("[aria-invalid='true']");
      firstInvalid?.focus();
      return;
    }

    submittingRef.current = true;
    setState("submitting");
    let retryAfterHeader: number | null = null;
    const fetchOptions = {
      onResponse: (context: { response: Response }) => {
        const raw =
          context.response.headers.get("X-Retry-After") ??
          context.response.headers.get("Retry-After");
        if (raw) {
          const parsed = Number.parseInt(raw, 10);
          retryAfterHeader = Number.isFinite(parsed) ? parsed : null;
        }
      },
    };
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name }, fetchOptions)
          : await authClient.signIn.email({ email, password }, fetchOptions);

      if (result.error) {
        submittingRef.current = false;
        setState("idle");
        if (isAuthRateLimitError(result.error)) {
          const seconds = authRetryAfterSeconds(result.error, retryAfterHeader) ?? 60;
          setRetryAfter(seconds);
          setFormError(tx(t, "auth.errors.rateLimitedWait", { seconds }));
          return;
        }
        setRetryAfter(0);
        setFormError(tx(t, authErrorMessageKey(result.error.code)));
        return;
      }

      if (mode === "sign-up") {
        sessionStorage.setItem("vimla.verifyEmail", email);
        const created = await fetchCurrentUser().catch(() => null);
        if (created) {
          await syncAuthenticatedLocale(created.locale);
        }
        await router.push("/verify-email");
        router.refresh();
        return;
      }

      submittingRef.current = false;
      setState("idle");
      const current = await fetchCurrentUser();
      await syncAuthenticatedLocale(current.locale);
      if (!current.emailVerified) {
        sessionStorage.setItem("vimla.verifyEmail", current.email);
        await router.push("/verify-email");
        router.refresh();
        return;
      }
      await router.push("/app");
      router.refresh();
    } catch {
      submittingRef.current = false;
      setState("idle");
      setFormError(tx(t, "errors.generic"));
    }
  }

  const submitDisabled = state === "submitting" || retryAfter > 0;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      {mode === "sign-up" ? (
        <label className={styles.field} htmlFor="auth-name">
          {t("auth.name")}
          <input
            id="auth-name"
            name="name"
            autoComplete="name"
            value={name}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "auth-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {fieldErrors.name ? (
            <span id="auth-name-error" className={styles.fieldError}>
              {fieldErrors.name}
            </span>
          ) : null}
        </label>
      ) : null}
      <label className={styles.field} htmlFor="auth-email">
        {t("auth.email")}
        <input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        {fieldErrors.email ? (
          <span id="auth-email-error" className={styles.fieldError}>
            {fieldErrors.email}
          </span>
        ) : null}
      </label>
      <label className={styles.field} htmlFor="auth-password">
        {t("auth.password")}
        <input
          id="auth-password"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          value={password}
          minLength={8}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        {fieldErrors.password ? (
          <span id="auth-password-error" className={styles.fieldError}>
            {fieldErrors.password}
          </span>
        ) : null}
      </label>
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={submitDisabled}>
        {state === "submitting"
          ? t("auth.working")
          : retryAfter > 0
            ? t("auth.errors.rateLimitedWait", { seconds: retryAfter })
            : mode === "sign-up"
              ? t("auth.createAccount")
              : t("auth.signIn")}
      </button>
    </form>
  );
}
