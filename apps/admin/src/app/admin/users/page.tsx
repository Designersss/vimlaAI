"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "../../../shared/api/admin-fetch";
import styles from "../admin.module.scss";

interface UserRow {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  twoFactorEnabled: boolean;
}

export default function UsersPage() {
  const t = useTranslations();
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [query, setQuery] = useState<Record<string, string>>({});

  async function load(nextSkip = 0, filters = query): Promise<void> {
    const params = new URLSearchParams({ limit: "50", offset: String(nextSkip), ...filters });
    const response = await adminFetch(`/admin/v1/users?${params.toString()}`);
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as { items: UserRow[]; total: number; skip: number };
    setItems(body.items);
    setTotal(body.total);
    setSkip(body.skip);
  }

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      const response = await adminFetch(`/admin/v1/users?${params.toString()}`);
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { items: UserRow[]; total: number; skip: number };
      setItems(body.items);
      setTotal(body.total);
      setSkip(body.skip);
    })();
  }, []);

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Record<string, string> = {};
    for (const key of ["userId", "email", "emailVerified"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value) {
        next[key] = value;
      }
    }
    setQuery(next);
    void load(0, next);
  }

  return (
    <section>
      <h1>{t("nav.users")}</h1>
      <form className={styles.filters} onSubmit={onSearch}>
        <input className={styles.input} name="userId" placeholder={t("explorer.userId")} />
        <input className={styles.input} name="email" placeholder="email" />
        <select className={styles.input} name="emailVerified" defaultValue="">
          <option value="">{t("explorer.verifiedAny")}</option>
          <option value="true">{t("explorer.verified")}</option>
          <option value="false">{t("explorer.unverified")}</option>
        </select>
        <button className={styles.button} type="submit">
          {t("explorer.search")}
        </button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>email</th>
            <th>{t("explorer.verified")}</th>
            <th>{t("finance.date")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/admin/users/${item.id}`}>{item.id.slice(0, 8)}</Link>
              </td>
              <td>{item.email}</td>
              <td>{item.emailVerified ? t("explorer.verified") : t("explorer.unverified")}</td>
              <td>{item.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? <p>{t("app.empty")}</p> : null}
      <div className={styles.filters}>
        <button type="button" className={styles.button} disabled={skip <= 0} onClick={() => void load(Math.max(0, skip - 50))}>
          {t("explorer.prev")}
        </button>
        <span>
          {skip + 1}–{Math.min(skip + items.length, total)} / {total}
        </span>
        <button type="button" className={styles.button} disabled={skip + items.length >= total} onClick={() => void load(skip + 50)}>
          {t("explorer.next")}
        </button>
      </div>
    </section>
  );
}
