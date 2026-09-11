"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { ProjectSummary } from "@vimla/contracts";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FormField,
  Heading,
  Input,
  ProjectRow,
  ProjectStatusBadge,
  Textarea,
} from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { ProjectsApiError, createProject, fetchProjects } from "../services/api";
import { ProjectShell } from "./ProjectShell";
import styles from "./Projects.module.scss";

export function ProjectsHome(): ReactElement {
  const t = useTranslations();
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    const page = await fetchProjects();
    setItems(page.items);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchProjects()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createProject({ name, description: description || null });
      setName("");
      setDescription("");
      await reload();
    } catch (caught: unknown) {
      setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProjectShell>
      <div className={styles.stack}>
        <Heading as="h1" size="page">
          {t("projects.title")}
        </Heading>
        {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
        <Card>
          <form className={styles.form} onSubmit={(event) => void onCreate(event)}>
            <FormField label={t("projects.name")} htmlFor="project-name">
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
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
        </Card>
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
    </ProjectShell>
  );
}
