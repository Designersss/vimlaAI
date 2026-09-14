"use client";

import { useState, type AnchorHTMLAttributes, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Heading,
  Input,
  PageHeader,
  PlusIcon,
  ProjectRow,
  ProjectStatusBadge,
  Spinner,
  Textarea,
} from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { ProjectsApiError, createProject } from "../services/api";
import { useProjectsWorkspace } from "./ProjectsWorkspaceProvider";
import styles from "./Projects.module.scss";

export function ProjectListPane({ selectedProjectId }: { selectedProjectId?: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { items, boot, errorCode, reload, upsertProject } = useProjectsWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    if (busy || trimmedName.length === 0) {
      return;
    }

    setCreateError(null);
    setBusy(true);
    try {
      const created = await createProject({
        name: trimmedName,
        description: description.trim().length > 0 ? description : null,
      });
      upsertProject(created);
      setName("");
      setDescription("");
      setCreateOpen(false);
      router.push(`/projects/${created.id}`, { scroll: false });
    } catch (caught: unknown) {
      setCreateError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
    } finally {
      setBusy(false);
    }
  }

  if (boot === "loading") {
    return (
      <div className={styles.paneStatus}>
        <Spinner label={t("common.loading")} />
      </div>
    );
  }

  if (boot === "failed") {
    return (
      <ErrorState
        title={tx(t, apiErrorMessageKey(errorCode ?? "internal_error"))}
        action={<Button onClick={() => void reload()}>{t("common.retry")}</Button>}
      />
    );
  }

  return (
    <>
      <div className={styles.collection} data-testid="projects-list-pane">
        <PageHeader
          title={
            <Heading as="h1" size="page">
              {t("projects.title")}
            </Heading>
          }
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon size={16} aria-hidden="true" />
              {t("projects.create")}
            </Button>
          }
        />
        {items.length === 0 ? (
          <EmptyState title={t("projects.empty")} />
        ) : (
          <div className={styles.list}>
            {items.map((item) => (
              <ProjectRow
                key={item.id}
                href={`/projects/${item.id}`}
                title={item.name}
                subtitle={item.description ?? undefined}
                selected={selectedProjectId === item.id}
                renderLink={renderProjectLink}
                members={
                  <ProjectStatusBadge
                    status={item.readOnly ? "locked" : "active"}
                    label={item.readOnly ? t("projects.locked") : t("projects.active")}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateError(null);
          }
        }}
        title={t("projects.create")}
        closeLabel={t("common.close")}
      >
        <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
          {createError ? <Alert variant="error">{tx(t, apiErrorMessageKey(createError))}</Alert> : null}
          <FormField label={t("projects.name")} htmlFor="project-name">
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              autoFocus
            />
          </FormField>
          <FormField label={t("projects.description")} htmlFor="project-description">
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </FormField>
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            {t("projects.create")}
          </Button>
        </form>
      </Dialog>
    </>
  );
}

function renderProjectLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactElement {
  return <Link {...props} scroll={false} />;
}
