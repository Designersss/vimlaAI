"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ListType, ListView } from "@vimla/contracts";
import { Alert, Button, Card, EmptyState, FormField, Heading, Input, NativeSelect, Text } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, createList, fetchLists } from "../services/api";
import { useWorkspaceViewSync } from "./WorkspaceViewSync";
import styles from "./Work.module.scss";

export function WorkLists({ selectedListId }: { selectedListId?: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { listsRevision, invalidateLists } = useWorkspaceViewSync();
  const [items, setItems] = useState<ListView[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ListType>("CHECKLIST");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLists()
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
  }, [listsRevision]);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const created = await createList({ title, type });
      setTitle("");
      invalidateLists();
      router.push(`/work/lists/${created.id}`, { scroll: false });
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  return (
    <div className={`${styles.stack} ${styles.collectionPane}`} data-testid="work-lists-master">
      <Heading as="h1" size="page">
        {t("work.lists")}
      </Heading>
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      <Card>
        <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
          <FormField label={t("work.titleLabel")} htmlFor="list-title">
            <Input id="list-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </FormField>
          <FormField label={t("work.lists")} htmlFor="list-type">
            <NativeSelect id="list-type" value={type} onChange={(event) => setType(event.target.value as ListType)}>
              <option value="CHECKLIST">{t("work.checklist")}</option>
              <option value="PLAIN">{t("work.plainList")}</option>
            </NativeSelect>
          </FormField>
          <Button type="submit">{t("work.create")}</Button>
        </form>
      </Card>
      {items.length === 0 ? (
        <EmptyState title={t("work.emptyLists")} />
      ) : (
        <ul className={styles.stack}>
          {items.map((list) => (
            <li key={list.id}>
              <Card>
                <Link
                  href={`/work/lists/${list.id}`}
                  scroll={false}
                  aria-current={selectedListId === list.id ? "page" : undefined}
                >
                  {list.title}
                </Link>
                <Text tone="secondary">
                  {list.type === "CHECKLIST" ? t("work.checklist") : t("work.plainList")}
                </Text>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
