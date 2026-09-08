"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { maskEmail } from "@vimla/shared";
import { AuthRequiredError, fetchCurrentUser } from "../../services/current-user";
import { authClient } from "../../services/auth-client";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { OtpInput } from "../OtpInput/OtpInput";
import styles from "../AuthForm/AuthForm.module.scss";

export function VerifyEmailForm(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting">("idle");
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    const stored = sessionStorage.getItem("vimla.verifyEmail");
    void fetchCurrentUser()
      .then((user) => {
        setEmail(user.email);
        if (user.emailVerified) {
          router.replace("/app");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof AuthRequiredError) {
          setEmail(stored ?? "");
          if (!stored) {
            router.replace("/sign-in");
          }
        }
      });
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCooldown((value) => value - 1);
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [cooldown]);

  async function resend(): Promise<void> {
    if (cooldown > 0 || !email) {
      return;
    }
    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setCooldown(60);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (otp.length !== 6 || state === "submitting") {
      setFormError(t("validation.otpLength"));
      return;
    }
    setState("submitting");
    const result = await authClient.emailOtp.verifyEmail({ email, otp });
    setState("idle");
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    sessionStorage.removeItem("vimla.verifyEmail");
    router.push("/app");
    router.refresh();
  }

  if (!email) {
    return <p>{t("common.loading")}</p>;
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <p>{t("auth.verifyEmail.sentTo", { email: maskEmail(email) })}</p>
      <div className={styles.field}>
        <span id="email-otp-label">{t("auth.otp")}</span>
        <OtpInput
          labelledBy="email-otp-label"
          value={otp}
          onChange={setOtp}
          invalid={Boolean(formError)}
          disabled={state === "submitting"}
        />
      </div>
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? t("auth.working") : t("auth.verify")}
      </button>
      <button
        type="button"
        className={styles.submit}
        disabled={cooldown > 0}
        onClick={() => {
          void resend();
        }}
      >
        {cooldown > 0
          ? t("auth.verifyEmail.resendIn", { seconds: cooldown })
          : t("auth.verifyEmail.resend")}
      </button>
    </form>
  );
}
