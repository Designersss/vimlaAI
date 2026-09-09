"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NoteView } from "@vimla/contracts";
import { Alert, Button, FormField, Heading, Input, Text, Textarea } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, deleteNote, fetchNote, updateNote } from "../services/api";
import styles from "./Work.module.scss";

export function WorkNoteEditor({ noteId }: { noteId: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [note, setNote] = useState<NoteView | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dirty = note ? title !== note.title || content !== note.contentMarkdown : false;

  useEffect(() => {
    void fetchNote(noteId)
      .then((loaded) => {
        setNote(loaded);
        setTitle(loaded.title);
        setContent(loaded.contentMarkdown);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
      });
  }, [noteId]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = t("work.dirtyWarning");
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, t]);

  async function save(): Promise<void> {
    setError(null);
    try {
      const updated = await updateNote(noteId, { title, contentMarkdown: content });
      setNote(updated);
      setTitle(updated.title);
      setContent(updated.contentMarkdown);
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  if (!note && !error) {
    return <p>{t("work.loading")}</p>;
  }

  if (!note) {
    return <Alert variant="error">{tx(t, apiErrorMessageKey(error ?? "not_found"))}</Alert>;
  }

  return (
    <div className={styles.stack}>
      <Heading as="h1" size="page">
        {note.title}
      </Heading>
      {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
      {dirty ? <Text tone="secondary">{t("work.unsaved")}</Text> : null}
      <FormField label={t("work.titleLabel")} htmlFor="note-edit-title">
        <Input id="note-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </FormField>
      <FormField label={t("work.content")} htmlFor="note-content">
        <Textarea
          id="note-content"
          rows={16}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </FormField>
      <pre className={styles.noteBody}>{content}</pre>
      <div className={styles.row}>
        <Button onClick={() => void save()} disabled={!dirty}>
          {t("work.save")}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void updateNote(noteId, { pinned: !note.pinnedAt })
              .then((updated) => {
                setNote(updated);
                setTitle(updated.title);
                setContent(updated.contentMarkdown);
              })
              .catch((caught: unknown) => {
                setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
              })
          }
        >
          {note.pinnedAt ? t("work.unpin") : t("work.pin")}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void updateNote(noteId, { archived: !note.archivedAt })
              .then((updated) => {
                setNote(updated);
              })
              .catch((caught: unknown) => {
                setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
              })
          }
        >
          {note.archivedAt ? t("work.unarchive") : t("work.archive")}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void deleteNote(noteId)
              .then(() => router.push("/work/notes"))
              .catch((caught: unknown) => {
                setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
              })
          }
        >
          {t("work.delete")}
        </Button>
      </div>
    </div>
  );
}
