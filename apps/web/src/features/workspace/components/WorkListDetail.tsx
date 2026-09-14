"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ListView } from "@vimla/contracts";
import { Alert, Button, Card, Checkbox, EmptyState, FormField, Input } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import {
  WorkspaceApiError,
  addListItem,
  deleteList,
  deleteListItem,
  fetchList,
  reorderListItems,
  updateListItem,
} from "../services/api";
import { WorkDetailHeader } from "./WorkDetailHeader";
import { useWorkspaceViewSync } from "./WorkspaceViewSync";
import styles from "./Work.module.scss";

export function WorkListDetail({ listId }: { listId: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { invalidateLists } = useWorkspaceViewSync();
  const [list, setList] = useState<ListView | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchList(listId)
      .then((loaded) => {
        if (!cancelled) {
          setList(loaded);
          setError(null);
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
  }, [listId, loadRevision]);

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      setList(await addListItem(listId, { text }));
      setText((current) => (current === text ? "" : current));
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  async function onToggle(itemId: string, completed: boolean): Promise<void> {
    if (!list) {
      return;
    }
    const previous = list;
    setList({
      ...list,
      items: list.items.map((item) =>
        item.id === itemId ? { ...item, completedAt: completed ? item.completedAt ?? new Date().toISOString() : null } : item,
      ),
    });
    try {
      setList(await updateListItem(listId, itemId, { completed }));
    } catch (caught: unknown) {
      setList(previous);
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  async function move(itemId: string, direction: -1 | 1): Promise<void> {
    if (!list) {
      return;
    }
    const ids = list.items.map((item) => item.id);
    const index = ids.indexOf(itemId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) {
      return;
    }
    const reordered = [...ids];
    const moved = reordered[index];
    if (!moved) {
      return;
    }
    reordered.splice(index, 1);
    reordered.splice(next, 0, moved);
    try {
      setList(await reorderListItems(listId, { itemIds: reordered }));
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  if (!list) {
    return (
      <div className={styles.detailPane} data-testid="work-list-detail">
        <WorkDetailHeader backHref="/work/lists" title={t("work.lists")} />
        {error ? (
          <div className={styles.stack}>
            <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setLoadRevision((revision) => revision + 1);
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("work.loading")}</p>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.stack} ${styles.detailPane}`} data-testid="work-list-detail">
      <WorkDetailHeader backHref="/work/lists" title={list.title} />
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      <form className={styles.row} onSubmit={(event) => void onAdd(event)}>
        <FormField label={t("work.itemText")} htmlFor="list-item" className={styles.grow}>
          <Input id="list-item" value={text} onChange={(event) => setText(event.target.value)} required />
        </FormField>
        <Button type="submit">{t("work.addItem")}</Button>
      </form>
      {list.items.length === 0 ? (
        <EmptyState title={t("work.emptyItems")} />
      ) : (
        <ul className={styles.stack}>
          {list.items.map((item, index) => (
            <li key={item.id}>
              <Card>
                <div className={styles.row}>
                  {list.type === "CHECKLIST" ? (
                    <Checkbox
                      checked={Boolean(item.completedAt)}
                      label={item.text}
                      onChange={(event) => void onToggle(item.id, event.target.checked)}
                    />
                  ) : (
                    <span>{item.text}</span>
                  )}
                  <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => void move(item.id, -1)}>
                    {t("work.moveUp")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === list.items.length - 1}
                    onClick={() => void move(item.id, 1)}
                  >
                    {t("work.moveDown")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void deleteListItem(listId, item.id)
                        .then(setList)
                        .catch((caught: unknown) => {
                          setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
                        })
                    }
                  >
                    {t("work.delete")}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        onClick={() =>
          void deleteList(listId)
            .then(() => {
              invalidateLists();
              router.push("/work/lists", { scroll: false });
            })
            .catch((caught: unknown) => {
              setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
            })
        }
      >
        {t("work.delete")}
      </Button>
    </div>
  );
}
