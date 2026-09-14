"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NoteView } from "@vimla/contracts";
import { Alert, Button, FormField, Input, Text, Textarea } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { WorkspaceApiError, deleteNote, fetchNote, updateNote } from "../services/api";
import { WorkDetailHeader } from "./WorkDetailHeader";
import { useWorkspaceViewSync } from "./WorkspaceViewSync";
import styles from "./Work.module.scss";

export function WorkNoteEditor({ noteId }: { noteId: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { invalidateNotes } = useWorkspaceViewSync();
  const [note, setNote] = useState<NoteView | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const dirty = note ? title !== note.title || content !== note.contentMarkdown : false;

  useEffect(() => {
    let cancelled = false;
    void fetchNote(noteId)
      .then((loaded) => {
        if (!cancelled) {
          setNote(loaded);
          setTitle(loaded.title);
          setContent(loaded.contentMarkdown);
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
  }, [loadRevision, noteId]);

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
      invalidateNotes();
    } catch (caught: unknown) {
      setError(caught instanceof WorkspaceApiError ? caught.code : "internal_error");
    }
  }

  if (!note) {
    return (
      <div className={styles.detailPane} data-testid="work-note-detail">
        <WorkDetailHeader backHref="/work/notes" title={t("work.notes")} />
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
    <div className={`${styles.stack} ${styles.detailPane}`} data-testid="work-note-detail">
      <WorkDetailHeader backHref="/work/notes" title={note.title} />
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
                invalidateNotes();
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
                setTitle(updated.title);
                setContent(updated.contentMarkdown);
                invalidateNotes();
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
              .then(() => {
                invalidateNotes();
                router.push("/work/notes", { scroll: false });
              })
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
