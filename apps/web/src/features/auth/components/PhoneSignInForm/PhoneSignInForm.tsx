"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, FormField, Input, OtpInput, Text } from "@vimla/ui";
import { authClient } from "../../services/auth-client";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
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
      <FormField label={t("auth.phone")} htmlFor="phone-sign-in">
        <Input
          id="phone-sign-in"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
      </FormField>
      {stage === "otp" ? (
        <div>
          <Text as="span" tone="secondary" id="phone-otp-label">
            {t("auth.otp")}
          </Text>
          <OtpInput labelledBy="phone-otp-label" value={otp} onChange={setOtp} disabled={state === "submitting"} />
        </div>
      ) : null}
      {formError ? <Alert variant="error">{formError}</Alert> : null}
      <Button type="submit" disabled={state === "submitting" || (stage === "phone" && cooldown > 0)} loading={state === "submitting"} block>
        {stage === "phone"
          ? cooldown > 0
            ? t("auth.verifyEmail.resendIn", { seconds: cooldown })
            : t("auth.sendCode")
          : t("auth.verify")}
      </Button>
      {stage === "otp" ? <Text tone="caption">{t("auth.phoneSendSuccess")}</Text> : null}
    </form>
  );
}
