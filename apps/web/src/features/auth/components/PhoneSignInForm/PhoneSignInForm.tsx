"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "../../services/auth-client";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { OtpInput } from "../OtpInput/OtpInput";
import styles from "../AuthForm/AuthForm.module.scss";

export function PhoneSignInForm(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "submitting">("idle");
  const [cooldown, setCooldown] = useState(0);

  async function sendCode(): Promise<void> {
    if (state === "submitting" || cooldown > 0) {
      return;
    }
    setFormError(null);
    setState("submitting");
    const result = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
    setState("idle");
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setStage("otp");
    setCooldown(60);
    const timer = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (stage === "phone") {
      if (cooldown > 0) {
        return;
      }
      await sendCode();
      return;
    }
    if (otp.length !== 6 || state === "submitting") {
      setFormError(t("validation.otpLength"));
      return;
    }
    setState("submitting");
    const result = await authClient.phoneNumber.verify({
      phoneNumber: phone,
      code: otp,
    });
    setState("idle");
    if (result.error) {
      setFormError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      <label className={styles.field} htmlFor="phone-sign-in">
        {t("auth.phone")}
        <input
          id="phone-sign-in"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
      </label>
      {stage === "otp" ? (
        <div className={styles.field}>
          <span id="phone-otp-label">{t("auth.otp")}</span>
          <OtpInput labelledBy="phone-otp-label" value={otp} onChange={setOtp} disabled={state === "submitting"} />
        </div>
      ) : null}
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={state === "submitting"}>
        {state === "submitting"
          ? t("auth.working")
          : stage === "phone"
            ? cooldown > 0
              ? t("auth.verifyEmail.resendIn", { seconds: cooldown })
              : t("auth.sendCode")
            : t("auth.verify")}
      </button>
    </form>
  );
}
