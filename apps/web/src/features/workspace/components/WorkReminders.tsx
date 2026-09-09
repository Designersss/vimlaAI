"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { CurrentUser, ReminderView } from "@vimla/contracts";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  FormField,
  Heading,
  Input,
  Text,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../auth/services/current-user";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, createReminder, fetchReminders, updateReminder } from "../services/api";
import { fromDatetimeLocalValue, formatDateTime, suggestedTimeZone, toDatetimeLocalValue } from "../services/datetime";
import styles from "./Work.module.scss";

export function WorkReminders(): ReactElement {
  const t = useTranslations();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<ReminderView[]>([]);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [confirmTz, setConfirmTz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<{ id: string; title: string; at: string } | null>(null);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const suggested = suggestedTimeZone();

  async function reload(): Promise<void> {
    const [currentUser, page] = await Promise.all([fetchCurrentUser(), fetchReminders()]);
    setUser(currentUser);
    setItems(page.items);
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCurrentUser(), fetchReminders()])
      .then(([currentUser, page]) => {
        if (cancelled) {
          return;
        }
        setUser(currentUser);
        setItems(page.items);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof AuthRequiredError) {
          setError("unauthorized");
          return;
        }
        setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const iso = fromDatetimeLocalValue(scheduledAt);
    if (!iso) {
      setError("validation_error");
      return;
    }
    const timezone = user?.timezone ?? (confirmTz ? suggested : undefined);
    if (!timezone) {
      setError("timezone_required");
      return;
    }
    try {
      await createReminder({ title, scheduledAt: iso, timezone });
      setTitle("");
      setScheduledAt("");
      setNotice("saved");
      await reload();
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  async function onReschedule(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!reschedule) {
      return;
    }
    setRescheduleError(null);
    const iso = fromDatetimeLocalValue(reschedule.at);
    if (!iso) {
      setRescheduleError("validation_error");
      return;
    }
    try {
      await updateReminder(reschedule.id, { scheduledAt: iso });
      setReschedule(null);
      setNotice("saved");
      await reload();
    } catch (caught: unknown) {
      setRescheduleError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  return (
    <div className={styles.stack}>
      <Heading as="h1" size="page">
        {t("work.reminders")}
      </Heading>
      <Alert variant="info">{t("work.noDelivery")}</Alert>
      {user?.timezone ? (
        <Text tone="secondary">
          {t("work.timezone")}: {user.timezone}
        </Text>
      ) : (
        <Alert variant="info">{t("work.needTimezone")}</Alert>
      )}
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      {notice ? <Alert variant="success">{t("work.scheduledSaved")}</Alert> : null}
      <Card>
        <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
          <FormField label={t("work.titleLabel")} htmlFor="reminder-title">
            <Input
              id="reminder-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label={t("work.scheduledAt")} htmlFor="reminder-at">
            <Input
              id="reminder-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              required
            />
          </FormField>
          {!user?.timezone ? (
            <Checkbox
              checked={confirmTz}
              label={t("work.confirmSuggestedTz", { zone: suggested })}
              onChange={(event) => setConfirmTz(event.target.checked)}
            />
          ) : null}
          <Button type="submit">{t("work.create")}</Button>
        </form>
      </Card>
      {items.length === 0 ? (
        <EmptyState title={t("work.emptyReminders")} />
      ) : (
        <ul className={styles.stack}>
          {items.map((reminder) => (
            <li key={reminder.id}>
              <Card>
                <div className={styles.item}>
                  <strong>{reminder.title}</strong>
                  <Text tone="secondary">
                    {formatDateTime(reminder.scheduledAt, reminder.timezone)} · {reminder.timezone} ·{" "}
                    {reminder.status === "PENDING"
                      ? t("work.statusPENDING")
                      : reminder.status === "CANCELED"
                        ? t("work.statusCANCELED")
                        : reminder.status === "DELIVERED"
                          ? t("work.statusDELIVERED")
                          : t("work.statusFAILED")}
                  </Text>
                  <div className={styles.row}>
                    {reminder.status === "PENDING" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void updateReminder(reminder.id, { status: "CANCELED" })
                            .then(reload)
                            .catch((caught: unknown) => {
                              setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
                            })
                        }
                      >
                        {t("work.cancelReminder")}
                      </Button>
                    ) : null}
                    {reminder.status === "PENDING" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRescheduleError(null);
                          setReschedule({
                            id: reminder.id,
                            title: reminder.title,
                            at: toDatetimeLocalValue(reminder.scheduledAt),
                          });
                        }}
                      >
                        {t("work.reschedule")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={Boolean(reschedule)}
        onOpenChange={(open) => {
          if (!open) {
            setReschedule(null);
            setRescheduleError(null);
          }
        }}
        title={t("work.rescheduleTitle")}
        description={user?.timezone ? `${t("work.timezone")}: ${user.timezone}` : undefined}
        closeLabel={t("common.close")}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setReschedule(null);
                setRescheduleError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="reminder-reschedule-form">
              {t("work.rescheduleApply")}
            </Button>
          </>
        }
      >
        {reschedule ? (
          <form
            id="reminder-reschedule-form"
            className={styles.form}
            data-testid="reminder-reschedule-dialog"
            onSubmit={(event) => void onReschedule(event)}
          >
            {rescheduleError ? <Alert variant="error">{tx(t, apiErrorMessageKey(rescheduleError))}</Alert> : null}
            <Text>{reschedule.title}</Text>
            <FormField label={t("work.scheduledAt")} htmlFor="reminder-reschedule-at">
              <Input
                id="reminder-reschedule-at"
                type="datetime-local"
                value={reschedule.at}
                onChange={(event) => setReschedule({ ...reschedule, at: event.target.value })}
                required
              />
            </FormField>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
