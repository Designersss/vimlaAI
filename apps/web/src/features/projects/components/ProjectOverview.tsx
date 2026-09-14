"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ProjectLockReason, ProjectView } from "@vimla/contracts";
import {
  Alert,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  PlanLockedBanner,
  ProjectStatusBadge,
  Text,
  Textarea,
} from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import {
  ProjectsApiError,
  deleteProject,
  fetchProject,
  leaveProject,
  openProject,
  updateProject,
} from "../services/api";
import { ProjectShell } from "./ProjectShell";
import styles from "./Projects.module.scss";

export function ProjectOverview({ projectId }: { projectId: string }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void openProject(projectId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setProject(loaded);
        setName(loaded.name);
        setDescription(loaded.description ?? "");
      })
      .catch(async (caught: unknown) => {
        if (cancelled) {
          return;
        }
        try {
          const loaded = await fetchProject(projectId);
          if (cancelled) {
            return;
          }
          setProject(loaded);
          setName(loaded.name);
          setDescription(loaded.description ?? "");
        } catch {
          setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function onSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const updated = await updateProject(projectId, {
        name,
        description: description.trim().length > 0 ? description : null,
      });
      setProject(updated);
    } catch (caught: unknown) {
      setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await deleteProject(projectId);
      router.push("/projects");
    } catch (caught: unknown) {
      setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
      setBusy(false);
    }
  }

  async function onLeave(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await leaveProject(projectId);
      router.push("/projects");
    } catch (caught: unknown) {
      setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
      setBusy(false);
    }
  }

  if (!project && !error) {
    return (
      <ProjectShell projectId={projectId}>
        <Text>{t("common.loading")}</Text>
      </ProjectShell>
    );
  }

  if (!project) {
    return (
      <ProjectShell>
        <Alert variant="error">{tx(t, apiErrorMessageKey(error ?? "not_found"))}</Alert>
      </ProjectShell>
    );
  }

  return (
    <ProjectShell projectId={projectId}>
      <div className={styles.stack}>
        <div className={styles.row}>
          <Heading as="h1" size="page">
            {project.name}
          </Heading>
          <ProjectStatusBadge
            status={project.readOnly ? "locked" : "active"}
            label={project.readOnly ? t("projects.locked") : t("projects.active")}
          />
        </div>
        {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
        {project.readOnly ? <LockBanner reason={project.lockReason} /> : null}
        <Card>
          <form className={styles.form} onSubmit={(event) => void onSave(event)}>
            <FormField label={t("projects.name")} htmlFor="project-edit-name">
              <Input
                id="project-edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!project.capabilities.canEdit}
                required
                maxLength={120}
              />
            </FormField>
            <FormField label={t("projects.description")} htmlFor="project-edit-description">
              <Textarea
                id="project-edit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!project.capabilities.canEdit}
                rows={4}
              />
            </FormField>
            {project.capabilities.canEdit ? (
              <Button type="submit" disabled={busy}>
                {t("projects.save")}
              </Button>
            ) : (
              <Text tone="secondary">{t("projects.readOnly")}</Text>
            )}
          </form>
        </Card>
        <div className={styles.actions}>
          {project.capabilities.canLeave ? (
            <Button variant="secondary" disabled={busy} onClick={() => void onLeave()}>
              {t("projects.leave")}
            </Button>
          ) : null}
          {project.capabilities.canDelete ? (
            <Button variant="destructive" disabled={busy} onClick={() => void onDelete()}>
              {t("projects.delete")}
            </Button>
          ) : null}
        </div>
      </div>
    </ProjectShell>
  );
}

function LockBanner({ reason }: { reason: ProjectLockReason }): ReactElement {
  const t = useTranslations();
  const copy = copyForReason(reason);
  return (
    <div className={styles.stack}>
      <PlanLockedBanner title={t(copy.title)} description={t(copy.body)} />
      <Link href="/settings/billing">{t("projects.restorePlan")}</Link>
    </div>
  );
}

function copyForReason(reason: ProjectLockReason): { title: "projects.ownerPlanLockedTitle" | "projects.memberPlanLockedTitle" | "projects.ownerMemberCapTitle"; body: "projects.ownerPlanLockedBody" | "projects.memberPlanLockedBody" | "projects.ownerMemberCapBody" } {
  if (reason === "MEMBER_PLAN") {
    return { title: "projects.memberPlanLockedTitle", body: "projects.memberPlanLockedBody" };
  }
  if (reason === "OWNER_MEMBER_CAP") {
    return { title: "projects.ownerMemberCapTitle", body: "projects.ownerMemberCapBody" };
  }
  return { title: "projects.ownerPlanLockedTitle", body: "projects.ownerPlanLockedBody" };
}
