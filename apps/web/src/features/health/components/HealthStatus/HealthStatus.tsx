"use client";

import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { HealthResponse } from "@vimla/contracts";
import { Button, Card, Heading, StatusBadge, Text } from "@vimla/ui";
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
    <Card className={styles.panel} aria-live="polite">
      <header className={styles.header}>
        <Heading as="h2" size="section">
          {t("title")}
        </Heading>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void refresh();
          }}
          disabled={isRefreshing}
          loading={isRefreshing}
        >
          {t("refresh")}
        </Button>
      </header>
      {store.state === "failed" ? <Text>{store.errorMessage}</Text> : null}
      {health ? (
        <ul className={styles.checks}>
          <li>
            {t("api")}: <StatusBadge tone={health.checks.api.status === "ok" ? "success" : "danger"}>{health.checks.api.status}</StatusBadge>
          </li>
          <li>
            {t("postgres")}:{" "}
            <StatusBadge tone={health.checks.database.status === "ok" ? "success" : "danger"}>
              {health.checks.database.status}
            </StatusBadge>
          </li>
          <li>
            {t("redis")}: <StatusBadge tone={health.checks.redis.status === "ok" ? "success" : "danger"}>{health.checks.redis.status}</StatusBadge>
          </li>
        </ul>
      ) : (
        <Text tone="secondary">{t("empty")}</Text>
      )}
    </Card>
  );
});
