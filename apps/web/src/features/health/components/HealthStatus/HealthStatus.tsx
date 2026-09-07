"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
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
    } catch (error: unknown) {
      store.fail(error instanceof Error ? error.message : "Health request failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  const health = store.health;

  return (
    <section className={styles.panel} aria-live="polite">
      <header className={styles.header}>
        <h2 className={styles.title}>Backend health</h2>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => {
            void refresh();
          }}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Checking…" : "Refresh"}
        </button>
      </header>
      {store.state === "failed" ? (
        <p className={styles.error}>{store.errorMessage}</p>
      ) : null}
      {health ? (
        <ul className={styles.checks}>
          <li>API: {health.checks.api.status}</li>
          <li>PostgreSQL: {health.checks.database.status}</li>
          <li>Redis: {health.checks.redis.status}</li>
        </ul>
      ) : (
        <p className={styles.empty}>No health payload yet.</p>
      )}
    </section>
  );
});
