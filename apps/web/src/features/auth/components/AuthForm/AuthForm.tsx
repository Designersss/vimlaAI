"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { handleInputSchema, normalizeHandleInput } from "@vimla/contracts";
import { Alert, Button, FormField, Input, PasswordInput } from "@vimla/ui";
import { authClient } from "../../services/auth-client";
import { fetchCurrentUser } from "../../services/current-user";
import {
  checkHandleAvailability,
  claimHandle,
  HandleUnavailableError,
} from "../../services/handles";
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
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    handle?: string;
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
    const next: { name?: string; handle?: string; email?: string; password?: string } = {};
    if (mode === "sign-up" && name.trim().length === 0) {
      next.name = t("validation.nameMin");
    }
    if (mode === "sign-up" && !handleInputSchema.safeParse(handle).success) {
      next.handle = t("validation.required");
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

  function finishIdle(): void {
    submittingRef.current = false;
    setState("idle");
  }

  async function finishSignup(): Promise<void> {
    try {
      await claimHandle(handle);
    } catch (error: unknown) {
      finishIdle();
      if (error instanceof HandleUnavailableError) {
        setFieldErrors((current) => ({
          ...current,
          handle: tx(t, "auth.errors.registrationFailed"),
        }));
        return;
      }
      throw error;
    }

    sessionStorage.setItem("vimla.verifyEmail", email);
    const created = await fetchCurrentUser().catch(() => null);
    if (created) {
      await syncAuthenticatedLocale(created.locale);
    }
    await router.push("/verify-email");
    router.refresh();
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
      if (mode === "sign-up") {
        if (!accountCreated) {
          const availability = await checkHandleAvailability(handle);
          if (!availability.available) {
            finishIdle();
            setFieldErrors((current) => ({
              ...current,
              handle: tx(t, "auth.errors.registrationFailed"),
            }));
            return;
          }

          const result = await authClient.signUp.email({ email, password, name }, fetchOptions);
          if (result.error) {
            finishIdle();
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
          setAccountCreated(true);
        }

        await finishSignup();
        return;
      }

      const result = await authClient.signIn.email({ email, password }, fetchOptions);
      if (result.error) {
        finishIdle();
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

      finishIdle();
      const current = await fetchCurrentUser();
      await syncAuthenticatedLocale(current.locale);
      if (!current.emailVerified) {
        sessionStorage.setItem("vimla.verifyEmail", current.email);
        await router.push("/verify-email");
        router.refresh();
        return;
      }
      if (current.handleRequired) {
        await router.push("/claim-handle");
        router.refresh();
        return;
      }
      await router.push("/app");
      router.refresh();
    } catch (error: unknown) {
      finishIdle();
      if (error instanceof HandleUnavailableError) {
        setFieldErrors((current) => ({
          ...current,
          handle: tx(t, "auth.errors.registrationFailed"),
        }));
        return;
      }
      setFormError(tx(t, "errors.generic"));
    }
  }

  const submitDisabled = state === "submitting" || retryAfter > 0;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      {mode === "sign-up" ? (
        <>
          <FormField label={t("auth.name")} htmlFor="auth-name" error={fieldErrors.name}>
            <Input
              id="auth-name"
              name="name"
              autoComplete="name"
              value={name}
              disabled={accountCreated}
              invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "auth-name-error" : undefined}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField label="@login" htmlFor="auth-handle" error={fieldErrors.handle}>
            <Input
              id="auth-handle"
              name="handle"
              autoComplete="username"
              value={handle}
              invalid={Boolean(fieldErrors.handle)}
              aria-describedby={fieldErrors.handle ? "auth-handle-error" : undefined}
              onChange={(event) => {
                setHandle(normalizeHandleInput(event.target.value));
                setFieldErrors((current) => ({ ...current, handle: undefined }));
              }}
            />
          </FormField>
        </>
      ) : null}
      <FormField label={t("auth.email")} htmlFor="auth-email" error={fieldErrors.email}>
        <Input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          disabled={accountCreated}
          invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </FormField>
      <FormField label={t("auth.password")} htmlFor="auth-password" error={fieldErrors.password}>
        <PasswordInput
          id="auth-password"
          name="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          value={password}
          disabled={accountCreated}
          minLength={8}
          invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
          revealLabel={t("auth.revealPassword")}
          hideLabel={t("auth.hidePassword")}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </FormField>
      {formError ? <Alert variant="error">{formError}</Alert> : null}
      <Button type="submit" disabled={submitDisabled} loading={state === "submitting"} block>
        {retryAfter > 0
          ? t("auth.errors.rateLimitedWait", { seconds: retryAfter })
          : mode === "sign-up"
            ? t("auth.createAccount")
            : t("auth.signIn")}
      </Button>
    </form>
  );
}
