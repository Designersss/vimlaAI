"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import { AuthRequiredError, fetchCurrentUser } from "../../services/current-user";
import { authClient } from "../../services/auth-client";
import { passwordTooShort } from "../../services/validation";
import { Alert, Button, Card, FormField, Heading, Input, OtpInput, PasswordInput, Skeleton, Text } from "@vimla/ui";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import styles from "../AuthForm/AuthForm.module.scss";
import panel from "./SecuritySettings.module.scss";

interface SessionRow {
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt?: Date | string;
}

export function SecuritySettings(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [password, setPassword] = useState({ current: "", next: "" });
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneStage, setPhoneStage] = useState<"idle" | "otp">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [currentEmailOtp, setCurrentEmailOtp] = useState("");
  const [newEmailOtp, setNewEmailOtp] = useState("");
  const [emailStage, setEmailStage] = useState<"idle" | "current-otp" | "new-otp">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    const current = await fetchCurrentUser();
    setUser(current);
    const listed = await authClient.listSessions();
    if (!listed.error && Array.isArray(listed.data)) {
      setSessions(listed.data as SessionRow[]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), authClient.listSessions()])
      .then(([current, listed]) => {
        if (cancelled) {
          return;
        }
        setUser(current);
        if (!listed.error && Array.isArray(listed.data)) {
          setSessions(listed.data as SessionRow[]);
        }
        setBoot("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onChangePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (passwordTooShort(password.next)) {
      setError(t("validation.passwordMin"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.changePassword({
      currentPassword: password.current,
      newPassword: password.next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setMessage(t("auth.reset.success"));
    setPassword({ current: "", next: "" });
    await reload();
  }

  async function onSendCurrentEmailCode(): Promise<void> {
    if (!user?.emailVerified) {
      setError(t("auth.errors.emailNotVerified"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: user.email,
      type: "email-verification",
    });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setEmailStage("current-otp");
  }

  async function onConfirmCurrentEmail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.requestEmailChange({
      newEmail,
      otp: currentEmailOtp,
    });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setEmailStage("new-otp");
  }

  async function onConfirmNewEmail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.changeEmail({
      newEmail,
      otp: newEmailOtp,
    });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setMessage(t("settings.changeEmailSuccess"));
    setEmailStage("idle");
    setNewEmail("");
    setCurrentEmailOtp("");
    setNewEmailOtp("");
    await reload();
  }

  async function onSendPhone(): Promise<void> {
    if (!user?.emailVerified) {
      setError(t("auth.errors.emailNotVerified"));
      return;
    }
    setBusy(true);
    const result = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setPhoneStage("otp");
  }

  async function onVerifyPhone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const result = await authClient.phoneNumber.verify({
      phoneNumber: phone,
      code: otp,
      updatePhoneNumber: true,
    });
    setBusy(false);
    if (result.error) {
      setError(tx(t, authErrorMessageKey(result.error.code)));
      return;
    }
    setMessage(t("auth.phoneLinked"));
    setPhoneStage("idle");
    setOtp("");
    await reload();
  }

  async function revoke(token: string): Promise<void> {
    await authClient.revokeSession({ token });
    await reload();
  }

  async function revokeOthers(): Promise<void> {
    await authClient.revokeOtherSessions();
    await reload();
  }

  if (boot === "loading") {
    return <Skeleton />;
  }
  if (boot === "failed" || !user) {
    return <Alert variant="error">{t("common.genericError")}</Alert>;
  }

  const currentToken = sessions[0]?.token;

  return (
    <div className={panel.stack}>
      <Card>
        <Text data-testid="security-identity">
          {t("settings.email")}: {user.email} · {user.emailVerified ? t("settings.verified") : t("settings.unverified")}
        </Text>
        <Text>
          {t("settings.phone")}: {user.phoneNumber ?? t("settings.notLinked")} ·{" "}
          {user.phoneNumberVerified ? t("settings.linked") : t("settings.notLinked")}
        </Text>
      </Card>

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          if (emailStage === "current-otp") {
            void onConfirmCurrentEmail(event);
            return;
          }
          if (emailStage === "new-otp") {
            void onConfirmNewEmail(event);
          }
        }}
      >
        <Heading as="h3" size="sub">
          {t("settings.changeEmail")}
        </Heading>
        <FormField label={t("settings.newEmail")} htmlFor="new-email">
          <Input
            id="new-email"
            type="email"
            autoComplete="email"
            value={newEmail}
            disabled={emailStage !== "idle"}
            onChange={(event) => {
              setNewEmail(event.target.value);
            }}
          />
        </FormField>
        {emailStage === "current-otp" ? (
          <div>
            <Text as="span" tone="secondary" id="current-email-otp">
              {t("settings.currentEmailCode")}
            </Text>
            <OtpInput labelledBy="current-email-otp" value={currentEmailOtp} onChange={setCurrentEmailOtp} />
          </div>
        ) : null}
        {emailStage === "new-otp" ? (
          <div>
            <Text as="span" tone="secondary" id="new-email-otp">
              {t("settings.newEmailCode")}
            </Text>
            <OtpInput labelledBy="new-email-otp" value={newEmailOtp} onChange={setNewEmailOtp} />
          </div>
        ) : null}
        {emailStage === "idle" ? (
          <Button
            type="button"
            disabled={busy || !user.emailVerified || newEmail.length === 0}
            onClick={() => {
              void onSendCurrentEmailCode();
            }}
          >
            {t("settings.changeEmailSendCurrent")}
          </Button>
        ) : (
          <Button type="submit" disabled={busy} loading={busy}>
            {emailStage === "current-otp"
              ? t("settings.changeEmailConfirmCurrent")
              : t("settings.changeEmailConfirmNew")}
          </Button>
        )}
      </form>

      <form className={styles.form} noValidate onSubmit={(event) => void onChangePassword(event)}>
        <Heading as="h3" size="sub">
          {t("settings.changePassword")}
        </Heading>
        <FormField label={t("auth.currentPassword")} htmlFor="current-password">
          <PasswordInput
            id="current-password"
            autoComplete="current-password"
            value={password.current}
            revealLabel={t("auth.revealPassword")}
            hideLabel={t("auth.hidePassword")}
            onChange={(event) => {
              setPassword((value) => ({ ...value, current: event.target.value }));
            }}
          />
        </FormField>
        <FormField label={t("auth.newPassword")} htmlFor="new-password">
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            minLength={8}
            value={password.next}
            revealLabel={t("auth.revealPassword")}
            hideLabel={t("auth.hidePassword")}
            onChange={(event) => {
              setPassword((value) => ({ ...value, next: event.target.value }));
            }}
          />
        </FormField>
        <Button type="submit" disabled={busy} loading={busy}>
          {t("settings.changePassword")}
        </Button>
      </form>

      <form className={styles.form} noValidate onSubmit={(event) => void onVerifyPhone(event)}>
        <Heading as="h3" size="sub">
          {user.phoneNumberVerified ? t("settings.changePhone") : t("settings.addPhone")}
        </Heading>
        <FormField label={t("auth.phone")} htmlFor="security-phone">
          <Input
            id="security-phone"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </FormField>
        {phoneStage === "otp" ? (
          <div>
            <Text as="span" tone="secondary" id="security-otp">
              {t("auth.otp")}
            </Text>
            <OtpInput labelledBy="security-otp" value={otp} onChange={setOtp} />
          </div>
        ) : null}
        {phoneStage === "idle" ? (
          <Button
            id="security-send-phone"
            type="button"
            disabled={busy || !user.emailVerified}
            onClick={() => {
              void onSendPhone();
            }}
          >
            {t("auth.sendCode")}
          </Button>
        ) : (
          <Button type="submit" disabled={busy} loading={busy}>
            {t("auth.verify")}
          </Button>
        )}
      </form>

      <Card>
        <Heading as="h3" size="sub">
          {t("settings.sessions")}
        </Heading>
        {sessions.map((session, index) => (
          <div key={session.token} className={panel.session}>
            <Text>
              {index === 0 ? t("settings.currentSession") : t("settings.otherSessions")}:{" "}
              {session.userAgent ?? t("settings.unknownDevice")}
            </Text>
            {session.token !== currentToken || sessions.length === 1 ? null : (
              <Button type="button" variant="destructive" size="sm" onClick={() => void revoke(session.token)}>
                {t("settings.revoke")}
              </Button>
            )}
          </div>
        ))}
        {sessions.length <= 1 ? <Text tone="secondary">{t("settings.noOtherSessions")}</Text> : null}
        <Button type="button" variant="secondary" onClick={() => void revokeOthers()}>
          {t("settings.revokeOthers")}
        </Button>
      </Card>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
    </div>
  );
}
