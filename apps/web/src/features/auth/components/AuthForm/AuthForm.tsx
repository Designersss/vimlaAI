"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../services/auth-client";
import styles from "./AuthForm.module.scss";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
}

export function AuthForm({ mode }: AuthFormProps): ReactElement {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setState("loading");
    setErrorMessage(null);

    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({
            email,
            password,
            name,
          })
        : await authClient.signIn.email({
            email,
            password,
          });

    if (result.error) {
      setState("failed");
      setErrorMessage(result.error.message ?? "Authentication failed");
      return;
    }

    setState("idle");
    router.push("/app");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
      {mode === "sign-up" ? (
        <label className={styles.field}>
          Name
          <input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
          />
        </label>
      ) : null}
      <label className={styles.field}>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
        />
      </label>
      <label className={styles.field}>
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          minLength={8}
          required
        />
      </label>
      {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
      <button className={styles.submit} type="submit" disabled={state === "loading"}>
        {state === "loading"
          ? "Working…"
          : mode === "sign-up"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
