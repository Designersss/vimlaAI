"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, Heading, Text } from "@vimla/ui";
import { apiErrorMessageKey } from "../../../shared/errors/error-keys";
import { tx } from "../../../shared/i18n/translate";
import { ProjectsApiError, acceptInvite } from "../services/api";
import { ProjectShell } from "./ProjectShell";
import styles from "./Projects.module.scss";

export function ProjectJoin({ token }: { token: string | null }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(token ? null : "project_invite_invalid");
  const [busy, setBusy] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void acceptInvite(token)
      .then((project) => {
        if (!cancelled) {
          router.replace(`/projects/${project.id}`);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ProjectsApiError ? caught.code : "internal_error");
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <ProjectShell>
      <div className={styles.stack}>
        <Heading as="h1" size="page">
          {t("projects.joinTitle")}
        </Heading>
        {error ? <Alert variant="error">{tx(t, apiErrorMessageKey(error))}</Alert> : null}
        <Card>
          <Text>{busy ? t("common.loading") : t("projects.joinMissing")}</Text>
          <Button type="button" onClick={() => router.push("/projects")}>
            {t("projects.title")}
          </Button>
        </Card>
      </div>
    </ProjectShell>
  );
}
