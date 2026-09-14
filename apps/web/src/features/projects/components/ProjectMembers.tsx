"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type {
  ProjectInviteView,
  ProjectMemberRole,
  ProjectMemberView,
  ProjectView,
} from "@vimla/contracts";
import {
  Alert,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  NativeSelect,
  PlanLockedBanner,
  Text,
} from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import {
  ProjectsApiError,
  createInvite,
  fetchInvites,
  fetchMembers,
  fetchProject,
  openProject,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "../services/api";
import { ProjectShell } from "./ProjectShell";
import { useProjectsWorkspace } from "./ProjectsWorkspaceProvider";
import styles from "./Projects.module.scss";

export function ProjectMembers({ projectId }: { projectId: string }): ReactElement {
  const t = useTranslations();
  const { upsertProject } = useProjectsWorkspace();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [members, setMembers] = useState<ProjectMemberView[]>([]);
  const [invites, setInvites] = useState<ProjectInviteView[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">("MEMBER");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload(current: ProjectView): Promise<void> {
    const roster = await loadProjectRoster(projectId, current);
    setMembers(roster.members);
    setInvites(roster.invites);
  }

  useEffect(() => {
    let cancelled = false;
    void openProject(projectId)
      .catch(() => fetchProject(projectId))
      .then(async (loaded) => {
        const roster = await loadProjectRoster(projectId, loaded);
        if (cancelled) {
          return;
        }
        setProject(loaded);
        upsertProject(loaded);
        setMembers(roster.members);
        setInvites(roster.invites);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, upsertProject]);

  async function onInvite(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const created = await createInvite(projectId, { email, role });
      setInviteUrl(created.inviteUrl);
      setEmail("");
      if (project) {
        await reload(project);
      }
    } catch (caught: unknown) {
      setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
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
      <ProjectShell projectId={projectId}>
        <Alert variant="error">{tx(t, apiErrorMessageKey(error ?? "not_found"))}</Alert>
      </ProjectShell>
    );
  }

  return (
    <ProjectShell projectId={projectId}>
      <div className={styles.stack}>
        <Heading as="h1" size="page">
          {t("projects.members")}
        </Heading>
        {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
        {project.readOnly ? (
          <PlanLockedBanner
            title={t("projects.ownerPlanLockedTitle")}
            description={t("projects.ownerPlanLockedBody")}
          />
        ) : null}
        <div className={styles.list}>
          {members.map((member) => (
            <Card key={member.userId}>
              <div className={styles.memberRow}>
                <div className={styles.memberMeta}>
                  <Text>{member.name || member.email}</Text>
                  <Text tone="caption">{member.email}</Text>
                  <Text tone="caption">
                    {t(projectRoleMessageKey(member.role))}
                    {member.accessState !== "ACTIVE" ? ` · ${t("projects.readOnly")}` : ""}
                  </Text>
                </div>
                {project.capabilities.canManageMembers && member.role !== "OWNER" ? (
                  <div className={styles.actions}>
                    <NativeSelect
                      value={member.role}
                      aria-label={t("projects.role")}
                      onChange={(event) => {
                        const next = event.target.value as "ADMIN" | "MEMBER" | "VIEWER";
                        void updateMemberRole(projectId, member.userId, { role: next })
                          .then((page) => setMembers(page.items))
                          .catch((caught: unknown) => {
                            setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
                          });
                      }}
                    >
                      <option value="ADMIN">{t("projects.roleADMIN")}</option>
                      <option value="MEMBER">{t("projects.roleMEMBER")}</option>
                      <option value="VIEWER">{t("projects.roleVIEWER")}</option>
                    </NativeSelect>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        void removeMember(projectId, member.userId)
                          .then(() => reload(project))
                          .catch((caught: unknown) => {
                            setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
                          });
                      }}
                    >
                      {t("projects.remove")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
        {project.capabilities.canInvite ? (
          <Card>
            <form className={styles.form} onSubmit={(event) => void onInvite(event)}>
              <FormField label={t("projects.inviteEmail")} htmlFor="project-invite-email">
                <Input
                  id="project-invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </FormField>
              <FormField label={t("projects.role")} htmlFor="project-invite-role">
                <NativeSelect
                  id="project-invite-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as "ADMIN" | "MEMBER" | "VIEWER")}
                >
                  <option value="ADMIN">{t("projects.roleADMIN")}</option>
                  <option value="MEMBER">{t("projects.roleMEMBER")}</option>
                  <option value="VIEWER">{t("projects.roleVIEWER")}</option>
                </NativeSelect>
              </FormField>
              <Button type="submit">{t("projects.invite")}</Button>
            </form>
            {inviteUrl ? (
              <Text tone="caption" className={styles.inviteLink}>
                {t("projects.copyLink")}: {inviteUrl}
              </Text>
            ) : null}
          </Card>
        ) : null}
        {invites.length > 0 ? (
          <div className={styles.stack}>
            <Heading as="h2" size="section">
              {t("projects.pendingInvites")}
            </Heading>
            {invites.map((invite) => (
              <Card key={invite.id}>
                <div className={styles.memberRow}>
                  <Text>
                    {invite.email} · {t(projectRoleMessageKey(invite.role))}
                  </Text>
                  {project.capabilities.canManageMembers ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void revokeInvite(projectId, invite.id)
                          .then(() => reload(project))
                          .catch((caught: unknown) => {
                            setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
                          });
                      }}
                    >
                      {t("projects.revoke")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </ProjectShell>
  );
}

async function loadProjectRoster(
  projectId: string,
  current: ProjectView,
): Promise<{ members: ProjectMemberView[]; invites: ProjectInviteView[] }> {
  const [memberPage, invitePage] = await Promise.all([
    fetchMembers(projectId),
    current.capabilities.canManageMembers || current.capabilities.canInvite
      ? fetchInvites(projectId)
      : Promise.resolve({ items: [] as ProjectInviteView[] }),
  ]);
  return { members: memberPage.items, invites: invitePage.items };
}

function projectRoleMessageKey(
  role: ProjectMemberRole,
): "projects.roleOWNER" | "projects.roleADMIN" | "projects.roleMEMBER" | "projects.roleVIEWER" {
  if (role === "OWNER") {
    return "projects.roleOWNER";
  }
  if (role === "ADMIN") {
    return "projects.roleADMIN";
  }
  if (role === "VIEWER") {
    return "projects.roleVIEWER";
  }
  return "projects.roleMEMBER";
}
