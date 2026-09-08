"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { HealthResponse } from "@vimla/contracts";
import { fetchApiHealth } from "../../../../shared/api/health";
import { HealthStore } from "../../stores/health-store";
import styles from "./HealthStatus.module.scss";

interface HealthStatusProps {
  initialHealth: HealthResponse | null;
  initialError: string | null;
}

export const HealthStatus = observer(function HealthStatus({
  initialHealth,
  initialError,
}: HealthStatusProps) {
  const t = useTranslations("health");
  const store = useMemo(() => new HealthStore(), []);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (initialHealth) {
      store.succeed(initialHealth);
      return;
    }

    if (initialError) {
      store.fail(initialError);
    }
  }, [initialError, initialHealth, store]);

  async function refresh(): Promise<void> {
    setIsRefreshing(true);
    store.startLoading();
    try {
      const health = await fetchApiHealth();
      store.succeed(health);
    } catch {
      store.fail(t("failed"));
    } finally {
      setIsRefreshing(false);
    }
  }

  const health = store.health;

  return (
    <section className={styles.panel} aria-live="polite">
      <header className={styles.header}>
        <h2 className={styles.title}>{t("title")}</h2>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => {
            void refresh();
          }}
          disabled={isRefreshing}
        >
          {isRefreshing ? t("checking") : t("refresh")}
        </button>
      </header>
      {store.state === "failed" ? (
        <p className={styles.error}>{store.errorMessage}</p>
      ) : null}
      {health ? (
        <ul className={styles.checks}>
          <li>
            {t("api")}: {health.checks.api.status}
          </li>
          <li>
            {t("postgres")}: {health.checks.database.status}
          </li>
          <li>
            {t("redis")}: {health.checks.redis.status}
          </li>
        </ul>
      ) : (
        <p className={styles.empty}>{t("empty")}</p>
      )}
    </section>
  );
});
