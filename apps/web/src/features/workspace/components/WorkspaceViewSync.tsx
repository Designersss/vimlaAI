"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

type WorkspaceViewSync = {
  notesRevision: number;
  listsRevision: number;
  invalidateNotes: () => void;
  invalidateLists: () => void;
};

const fallback: WorkspaceViewSync = {
  notesRevision: 0,
  listsRevision: 0,
  invalidateNotes: () => undefined,
  invalidateLists: () => undefined,
};

const WorkspaceViewSyncContext = createContext<WorkspaceViewSync>(fallback);

export function WorkspaceViewSyncProvider({ children }: { children: ReactNode }): ReactElement {
  const [notesRevision, setNotesRevision] = useState(0);
  const [listsRevision, setListsRevision] = useState(0);
  const invalidateNotes = useCallback(() => setNotesRevision((revision) => revision + 1), []);
  const invalidateLists = useCallback(() => setListsRevision((revision) => revision + 1), []);
  const value = useMemo(
    () => ({ notesRevision, listsRevision, invalidateNotes, invalidateLists }),
    [invalidateLists, invalidateNotes, listsRevision, notesRevision],
  );

  return <WorkspaceViewSyncContext.Provider value={value}>{children}</WorkspaceViewSyncContext.Provider>;
}

export function useWorkspaceViewSync(): WorkspaceViewSync {
  return useContext(WorkspaceViewSyncContext);
}
