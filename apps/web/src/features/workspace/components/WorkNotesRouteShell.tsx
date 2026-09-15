"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { WorkNotes } from "./WorkNotes";
import styles from "./Work.module.scss";

export function WorkNotesRouteShell({ children }: { children: ReactNode }): ReactElement {
  const selectedNoteId = useSelectedLayoutSegment() ?? undefined;
  const t = useTranslations();

  return (
    <div className={styles.collectionWorkspace} data-testid="work-notes-shell">
      <MasterDetailLayout
        detailOpen={Boolean(selectedNoteId)}
        masterLabel={t("work.notes")}
        detailLabel={t("work.notes")}
        master={<WorkNotes selectedNoteId={selectedNoteId} />}
      >
        {children}
      </MasterDetailLayout>
    </div>
  );
}
