"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import {
  AuthRequiredError,
  fetchCurrentUser,
} from "../../services/current-user";
import { authClient } from "../../services/auth-client";
import type { CurrentUser, UsageResponse } from "@vimla/contracts";
import { fetchUsage } from "../../../billing/services/usage";
import styles from "./SignedInHome.module.scss";

export function SignedInHome(): ReactElement {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser()
      .then(async (currentUser) => {
        const currentUsage = await fetchUsage();
        if (!cancelled) {
          setUser(currentUser);
          setUsage(currentUsage);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }

        setState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  if (state === "loading") {
    return <p className={styles.copy}>Checking session…</p>;
  }

  if (state === "failed" || !user || !usage) {
    return <p className={styles.copy}>Unable to load the current user.</p>;
  }

  return (
    <section className={styles.panel}>
      <p className={styles.copy}>Signed in as {user.email}</p>
      <p className={styles.copy}>
        Monthly usage {usage.monthly.usedPercent}% · remaining{" "}
        {usage.monthly.remainingMicroRub} microRUB
      </p>
      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </section>
  );
}
