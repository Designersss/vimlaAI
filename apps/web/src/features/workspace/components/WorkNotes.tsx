"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NoteView } from "@vimla/contracts";
import { Alert, Button, Card, EmptyState, FormField, Heading, Input, SearchInput, Text } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, createNote, fetchNotes } from "../services/api";
import styles from "./Work.module.scss";

export function WorkNotes(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState<NoteView[]>([]);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(nextQuery = query, nextArchived = archived): Promise<void> {
    setItems((await fetchNotes({ q: nextQuery || undefined, archived: nextArchived })).items);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchNotes()
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
  }, []);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const created = await createNote({ title, contentMarkdown: "" });
      setTitle("");
      router.push(`/work/notes/${created.id}`);
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  return (
    <div className={styles.stack}>
      <Heading as="h1" size="page">
        {t("work.notes")}
      </Heading>
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      <div className={styles.row}>
        <SearchInput
          value={query}
          placeholder={t("work.search")}
          aria-label={t("work.search")}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            void reload(value, archived).catch((caught: unknown) => {
              setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
            });
          }}
        />
        <Button
          variant={archived ? "primary" : "secondary"}
          size="sm"
          onClick={() => {
            const next = !archived;
            setArchived(next);
            void reload(query, next).catch((caught: unknown) => {
              setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
            });
          }}
        >
          {t("work.showArchived")}
        </Button>
      </div>
      <Card>
        <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
          <FormField label={t("work.titleLabel")} htmlFor="note-title">
            <Input id="note-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </FormField>
          <Button type="submit">{t("work.create")}</Button>
        </form>
      </Card>
      {items.length === 0 ? (
        <EmptyState title={t("work.emptyNotes")} />
      ) : (
        <ul className={styles.stack}>
          {items.map((note) => (
            <li key={note.id}>
              <Card>
                <Link href={`/work/notes/${note.id}`}>{note.title}</Link>
                {note.pinnedAt ? <Text tone="secondary">{t("work.pin")}</Text> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
