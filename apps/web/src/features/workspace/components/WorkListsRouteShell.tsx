"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { WorkLists } from "./WorkLists";
import styles from "./Work.module.scss";

export function WorkListsRouteShell({ children }: { children: ReactNode }): ReactElement {
  const selectedListId = useSelectedLayoutSegment() ?? undefined;
  const t = useTranslations();

  return (
    <div className={styles.collectionWorkspace} data-testid="work-lists-shell">
      <MasterDetailLayout
        detailOpen={Boolean(selectedListId)}
        masterLabel={t("work.lists")}
        detailLabel={t("work.lists")}
        master={<WorkLists selectedListId={selectedListId} />}
      >
        {children}
      </MasterDetailLayout>
    </div>
  );
}
