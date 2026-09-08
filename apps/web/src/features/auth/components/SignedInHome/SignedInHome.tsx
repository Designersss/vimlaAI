"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AuthRequiredError,
  fetchCurrentUser,
} from "../../services/current-user";
import { authClient } from "../../services/auth-client";
import type { CurrentUser, UsageResponse } from "@vimla/contracts";
import { fetchUsage } from "../../../billing/services/usage";
import styles from "./SignedInHome.module.scss";

export function SignedInHome(): ReactElement {
  const t = useTranslations();
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
    return <p className={styles.copy}>{t("common.loading")}</p>;
  }

  if (state === "failed" || !user || !usage) {
    return <p className={styles.copy}>{t("common.genericError")}</p>;
  }

  return (
    <section className={styles.panel}>
      <p className={styles.copy}>{t("chat.signedInAs", { email: user.email })}</p>
      <p className={styles.copy}>
        {t("chat.monthlyUsage")}: {usage.monthly.usedPercent}%
      </p>
      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          void signOut();
        }}
      >
        {t("nav.signOut")}
      </button>
    </section>
  );
}
