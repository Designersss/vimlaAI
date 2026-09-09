"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { WorkspaceTodayResponse } from "@vimla/contracts";
import { Alert, Card, EmptyState, Heading, Text } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, fetchToday } from "../services/api";
import { formatDateTime } from "../services/datetime";
import styles from "./Work.module.scss";

export function WorkToday(): ReactElement {
  const t = useTranslations();
  const [data, setData] = useState<WorkspaceTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchToday()
      .then(setData)
      .catch((caught: unknown) => {
        setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
      });
  }, []);

  if (error) {
    return <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert>;
  }

  if (!data) {
    return <Text>{t("work.loading")}</Text>;
  }

  const empty =
    data.overdueTasks.length === 0 && data.todayTasks.length === 0 && data.todayReminders.length === 0;

  return (
    <div className={styles.stack}>
      <Heading as="h1" size="page">
        {t("work.today")}
      </Heading>
      {!data.timezone ? <Alert variant="info">{t("work.needTimezone")}</Alert> : null}
      {empty ? <EmptyState title={t("work.emptyToday")} /> : null}
      {data.overdueTasks.length > 0 ? (
        <Card>
          <Heading as="h2" size="section">
            {t("work.overdue")}
          </Heading>
          <ul className={styles.stack}>
            {data.overdueTasks.map((task) => (
              <li key={task.id}>
                <Link href="/work/tasks">{task.title}</Link>
                <Text tone="secondary">{formatDateTime(task.dueAt)}</Text>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.todayTasks.length > 0 ? (
        <Card>
          <Heading as="h2" size="section">
            {t("work.dueToday")}
          </Heading>
          <ul className={styles.stack}>
            {data.todayTasks.map((task) => (
              <li key={task.id}>
                <Link href="/work/tasks">{task.title}</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.todayReminders.length > 0 ? (
        <Card>
          <Heading as="h2" size="section">
            {t("work.remindersToday")}
          </Heading>
          <ul className={styles.stack}>
            {data.todayReminders.map((reminder) => (
              <li key={reminder.id}>
                <Link href="/work/reminders">{reminder.title}</Link>
                <Text tone="secondary">{formatDateTime(reminder.scheduledAt, reminder.timezone)}</Text>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
