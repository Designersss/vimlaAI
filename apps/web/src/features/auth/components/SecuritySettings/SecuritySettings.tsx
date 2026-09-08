"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import { AuthRequiredError, fetchCurrentUser } from "../../services/current-user";
import { authClient } from "../../services/auth-client";
import { passwordTooShort } from "../../services/validation";
import { authErrorMessageKey } from "../../../../shared/errors/error-keys";
import { tx } from "../../../../shared/i18n/translate";
import { OtpInput } from "../OtpInput/OtpInput";
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
    return <p>{t("common.loading")}</p>;
  }
  if (boot === "failed" || !user) {
    return <p>{t("common.genericError")}</p>;
  }

  const currentToken = sessions[0]?.token;

  return (
    <div className={panel.stack}>
      <section className={panel.card}>
        <h2>{t("settings.securityTitle")}</h2>
        <p>
          {t("settings.email")}: {user.email} · {user.emailVerified ? t("settings.verified") : t("settings.unverified")}
        </p>
        <p>
          {t("settings.phone")}: {user.phoneNumber ?? t("settings.notLinked")} ·{" "}
          {user.phoneNumberVerified ? t("settings.linked") : t("settings.notLinked")}
        </p>
      </section>

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
        <h3>{t("settings.changeEmail")}</h3>
        <label className={styles.field} htmlFor="new-email">
          {t("settings.newEmail")}
          <input
            id="new-email"
            type="email"
            autoComplete="email"
            value={newEmail}
            disabled={emailStage !== "idle"}
            onChange={(event) => {
              setNewEmail(event.target.value);
            }}
          />
        </label>
        {emailStage === "current-otp" ? (
          <div className={styles.field}>
            <span id="current-email-otp">{t("settings.currentEmailCode")}</span>
            <OtpInput labelledBy="current-email-otp" value={currentEmailOtp} onChange={setCurrentEmailOtp} />
          </div>
        ) : null}
        {emailStage === "new-otp" ? (
          <div className={styles.field}>
            <span id="new-email-otp">{t("settings.newEmailCode")}</span>
            <OtpInput labelledBy="new-email-otp" value={newEmailOtp} onChange={setNewEmailOtp} />
          </div>
        ) : null}
        {emailStage === "idle" ? (
          <button
            className={styles.submit}
            type="button"
            disabled={busy || !user.emailVerified || newEmail.length === 0}
            onClick={() => {
              void onSendCurrentEmailCode();
            }}
          >
            {t("settings.changeEmailSendCurrent")}
          </button>
        ) : (
          <button className={styles.submit} type="submit" disabled={busy}>
            {emailStage === "current-otp"
              ? t("settings.changeEmailConfirmCurrent")
              : t("settings.changeEmailConfirmNew")}
          </button>
        )}
      </form>

      <form className={styles.form} noValidate onSubmit={(event) => void onChangePassword(event)}>
        <h3>{t("settings.changePassword")}</h3>
        <label className={styles.field} htmlFor="current-password">
          {t("auth.currentPassword")}
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={password.current}
            onChange={(event) => {
              setPassword((value) => ({ ...value, current: event.target.value }));
            }}
          />
        </label>
        <label className={styles.field} htmlFor="new-password">
          {t("auth.newPassword")}
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password.next}
            onChange={(event) => {
              setPassword((value) => ({ ...value, next: event.target.value }));
            }}
          />
        </label>
        <button className={styles.submit} type="submit" disabled={busy}>
          {t("settings.changePassword")}
        </button>
      </form>

      <form className={styles.form} noValidate onSubmit={(event) => void onVerifyPhone(event)}>
        <h3>{user.phoneNumberVerified ? t("settings.changePhone") : t("settings.addPhone")}</h3>
        <label className={styles.field} htmlFor="security-phone">
          {t("auth.phone")}
          <input
            id="security-phone"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>
        {phoneStage === "otp" ? (
          <div className={styles.field}>
            <span id="security-otp">{t("auth.otp")}</span>
            <OtpInput labelledBy="security-otp" value={otp} onChange={setOtp} />
          </div>
        ) : null}
        {phoneStage === "idle" ? (
          <button
            id="security-send-phone"
            className={styles.submit}
            type="button"
            disabled={busy || !user.emailVerified}
            onClick={() => {
              void onSendPhone();
            }}
          >
            {t("auth.sendCode")}
          </button>
        ) : (
          <button className={styles.submit} type="submit" disabled={busy}>
            {t("auth.verify")}
          </button>
        )}
      </form>

      <section className={panel.card}>
        <h3>{t("settings.sessions")}</h3>
        {sessions.map((session, index) => (
          <div key={session.token} className={panel.session}>
            <p>
              {index === 0 ? t("settings.currentSession") : t("settings.otherSessions")}:{" "}
              {session.userAgent ?? t("settings.unknownDevice")}
            </p>
            {session.token !== currentToken || sessions.length === 1 ? null : (
              <button type="button" className={styles.submit} onClick={() => void revoke(session.token)}>
                {t("settings.revoke")}
              </button>
            )}
          </div>
        ))}
        {sessions.length <= 1 ? <p>{t("settings.noOtherSessions")}</p> : null}
        <button type="button" className={styles.submit} onClick={() => void revokeOthers()}>
          {t("settings.revokeOthers")}
        </button>
      </section>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
