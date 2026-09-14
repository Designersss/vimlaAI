"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ProjectSummary } from "@vimla/contracts";
import { ProjectsApiError, fetchProjects } from "../services/api";

type ProjectsBootState = "loading" | "ready" | "failed";

type ProjectsWorkspaceValue = {
  items: ProjectSummary[];
  boot: ProjectsBootState;
  errorCode: string | null;
  reload: () => Promise<void>;
  upsertProject: (project: ProjectSummary) => void;
  removeProject: (projectId: string) => void;
};

const ProjectsWorkspaceContext = createContext<ProjectsWorkspaceValue | null>(null);

export function ProjectsWorkspaceProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [boot, setBoot] = useState<ProjectsBootState>("loading");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setBoot("loading");
    setErrorCode(null);
    try {
      const page = await fetchProjects();
      setItems(page.items);
      setBoot("ready");
    } catch (caught: unknown) {
      setErrorCode(caught instanceof ProjectsApiError ? caught.code : "internal_error");
      setBoot("failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchProjects()
      .then((page) => {
        if (cancelled) {
          return;
        }
        setItems(page.items);
        setErrorCode(null);
        setBoot("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorCode(caught instanceof ProjectsApiError ? caught.code : "internal_error");
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertProject = useCallback((project: ProjectSummary): void => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === project.id);
      if (index === -1) {
        return [project, ...current];
      }
      const next = current.slice();
      next[index] = project;
      return next;
    });
  }, []);

  const removeProject = useCallback((projectId: string): void => {
    setItems((current) => current.filter((item) => item.id !== projectId));
  }, []);

  const value = useMemo<ProjectsWorkspaceValue>(
    () => ({ items, boot, errorCode, reload, upsertProject, removeProject }),
    [boot, errorCode, items, reload, removeProject, upsertProject],
  );

  return <ProjectsWorkspaceContext.Provider value={value}>{children}</ProjectsWorkspaceContext.Provider>;
}

export function useProjectsWorkspace(): ProjectsWorkspaceValue {
  const value = useContext(ProjectsWorkspaceContext);
  if (!value) {
    throw new Error("useProjectsWorkspace must be used inside ProjectsWorkspaceProvider");
  }
  return value;
}
