"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@vimla/ui";
import styles from "./Work.module.scss";

export function WorkCollectionHome({ kind }: { kind: "notes" | "lists" }): ReactElement {
  const t = useTranslations();
  const title = kind === "notes" ? t("work.notes") : t("work.lists");

  return (
    <div className={styles.collectionHome} data-testid={`work-${kind}-home`}>
      <EmptyState title={title} />
    </div>
  );
}
