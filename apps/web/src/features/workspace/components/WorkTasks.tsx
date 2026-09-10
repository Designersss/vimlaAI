"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { TaskStatus, TaskView } from "@vimla/contracts";
import { Alert, Button, Card, Checkbox, EmptyState, FormField, Heading, Input, NativeSelect, TaskRow } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, createTask, deleteTask, fetchTasks, updateTask } from "../services/api";
import { fromDatetimeLocalValue } from "../services/datetime";
import styles from "./Work.module.scss";

export function WorkTasks(): ReactElement {
  const t = useTranslations();
  const [items, setItems] = useState<TaskView[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<"LOW" | "NORMAL" | "HIGH" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");

  async function reload(): Promise<void> {
    const page = await fetchTasks({ status: statusFilter || undefined });
    setItems(page.items);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchTasks({ status: statusFilter || undefined })
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await createTask({
        title,
        dueAt: fromDatetimeLocalValue(dueAt),
        priority: priority || null,
      });
      setTitle("");
      setDueAt("");
      setPriority("");
      await reload();
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  async function onToggle(task: TaskView): Promise<void> {
    const nextStatus = task.status === "DONE" ? "TODO" : "DONE";
    const previous = items;
    setItems(items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    try {
      await updateTask(task.id, { status: nextStatus });
      await reload();
    } catch (caught: unknown) {
      setItems(previous);
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  const visible = items;

  return (
    <div className={styles.stack}>
      <Heading as="h1" size="page">
        {t("work.tasks")}
      </Heading>
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      <Card>
        <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
          <FormField label={t("work.titleLabel")} htmlFor="task-title">
            <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </FormField>
          <FormField label={t("work.due")} htmlFor="task-due">
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FormField>
          <FormField label={t("work.priority")} htmlFor="task-priority">
            <NativeSelect
              id="task-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as typeof priority)}
            >
              <option value="">{t("work.priorityNormal")}</option>
              <option value="LOW">{t("work.priorityLow")}</option>
              <option value="NORMAL">{t("work.priorityNormal")}</option>
              <option value="HIGH">{t("work.priorityHigh")}</option>
            </NativeSelect>
          </FormField>
          <Button type="submit">{t("work.create")}</Button>
        </form>
      </Card>
      <FormField label={t("work.status")} htmlFor="task-filter">
        <NativeSelect
          id="task-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "")}
        >
          <option value="">{t("work.tasks")}</option>
          <option value="TODO">{t("work.statusTODO")}</option>
          <option value="IN_PROGRESS">{t("work.statusIN_PROGRESS")}</option>
          <option value="DONE">{t("work.statusDONE")}</option>
          <option value="CANCELED">{t("work.statusCANCELED")}</option>
        </NativeSelect>
      </FormField>
      {visible.length === 0 ? (
        <EmptyState title={t("work.emptyTasks")} />
      ) : (
        <ul className={styles.stack}>
          {visible.map((task) => (
            <li key={task.id}>
              <Card>
                <TaskRow
                  title=""
                  leading={
                    <Checkbox
                      checked={task.status === "DONE"}
                      label={task.title}
                      onChange={() => void onToggle(task)}
                    />
                  }
                  trailing={
                    <div className={styles.row}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void updateTask(task.id, { status: "IN_PROGRESS" }).then(reload)}
                      >
                        {t("work.statusIN_PROGRESS")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void deleteTask(task.id)
                            .then(reload)
                            .catch((caught: unknown) => {
                              setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
                            })
                        }
                      >
                        {t("work.delete")}
                      </Button>
                    </div>
                  }
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
