"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Spinner } from "@vimla/ui";
import { WorkDetailHeader } from "./WorkDetailHeader";
import styles from "./Work.module.scss";

type WorkCollectionKind = "notes" | "lists";

function collectionMeta(kind: WorkCollectionKind): { backHref: string; key: "work.notes" | "work.lists" } {
  return kind === "notes"
    ? { backHref: "/work/notes", key: "work.notes" }
    : { backHref: "/work/lists", key: "work.lists" };
}

export function WorkDetailLoading({ kind }: { kind: WorkCollectionKind }): ReactElement {
  const t = useTranslations();
  const meta = collectionMeta(kind);
  return (
    <div className={styles.detailPane} data-testid={`work-${kind}-detail-status`}>
      <WorkDetailHeader backHref={meta.backHref} title={t(meta.key)} />
      <div className={styles.detailStatusBody} role="status">
        <Spinner label={t("work.loading")} />
      </div>
    </div>
  );
}

export function WorkDetailFailure({
  kind,
  reset,
}: {
  kind: WorkCollectionKind;
  reset: () => void;
}): ReactElement {
  const t = useTranslations();
  const meta = collectionMeta(kind);
  return (
    <div className={styles.detailPane} data-testid={`work-${kind}-detail-status`}>
      <WorkDetailHeader backHref={meta.backHref} title={t(meta.key)} />
      <div className={styles.detailStatusBody}>
        <ErrorState
          title={t("work.failed")}
          action={<Button onClick={reset}>{t("common.retry")}</Button>}
        />
      </div>
    </div>
  );
}
