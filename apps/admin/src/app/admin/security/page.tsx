"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminFetch } from "../../../shared/api/admin-fetch";
import styles from "../admin.module.scss";

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  principalId: string;
  createdAt: string;
  expiresAt: string;
  lastStrongAuthAt: string;
  lastSeenAt: string;
}

interface EventRow {
  id: string;
  kind: string;
  createdAt: string;
}

export default function SecurityPage() {
  const t = useTranslations();
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);

  async function loadAudit(nextSkip = 0): Promise<void> {
    const response = await adminFetch(`/admin/v1/security/audit?limit=50&offset=${nextSkip}`);
    if (response.ok) {
      const body = (await response.json()) as { items: AuditRow[]; total: number; skip: number };
      setAudit(body.items);
      setTotal(body.total);
      setSkip(body.skip);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/admin/v1/security/audit?limit=50&offset=0");
      if (response.ok) {
        const body = (await response.json()) as { items: AuditRow[]; total: number; skip: number };
        setAudit(body.items);
        setTotal(body.total);
        setSkip(body.skip);
      }
      const [sessionRes, eventRes] = await Promise.all([
        adminFetch("/admin/v1/security/sessions"),
        adminFetch("/admin/v1/security/events"),
      ]);
      if (sessionRes.ok) {
        setSessions((await sessionRes.json()) as SessionRow[]);
      }
      if (eventRes.ok) {
        setEvents((await eventRes.json()) as EventRow[]);
      }
    })();
  }, []);

  return (
    <section>
      <h1>{t("nav.security")}</h1>
      <h2>{t("nav.sessions")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>id</th>
            <th>principal</th>
            <th>lastStrongAuthAt</th>
            <th>expiresAt</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.id.slice(0, 8)}</td>
              <td>{session.principalId.slice(0, 8)}</td>
              <td>{session.lastStrongAuthAt}</td>
              <td>{session.expiresAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t("nav.audit")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>action</th>
            <th>resource</th>
            <th>{t("app.reason")}</th>
            <th>{t("finance.date")}</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((row) => (
            <tr key={row.id}>
              <td>{row.action}</td>
              <td>
                {row.resourceType} {row.resourceId?.slice(0, 8) ?? ""}
              </td>
              <td>{row.reason ?? "—"}</td>
              <td>{row.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.filters}>
        <button type="button" className={styles.button} disabled={skip <= 0} onClick={() => void loadAudit(Math.max(0, skip - 50))}>
          {t("explorer.prev")}
        </button>
        <span>
          {skip + 1}–{Math.min(skip + audit.length, total)} / {total}
        </span>
        <button
          type="button"
          className={styles.button}
          disabled={skip + audit.length >= total}
          onClick={() => void loadAudit(skip + 50)}
        >
          {t("explorer.next")}
        </button>
      </div>
      <h2>{t("nav.events")}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>kind</th>
            <th>{t("finance.date")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{event.kind}</td>
              <td>{event.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
