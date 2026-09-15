"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, Heading, buttonClassName } from "@vimla/ui";
import styles from "./Work.module.scss";

export function WorkDetailHeader({ backHref, title }: { backHref: string; title: ReactNode }): ReactElement {
  const t = useTranslations();

  return (
    <div className={styles.detailHeader}>
      <Link
        href={backHref}
        scroll={false}
        aria-label={t("common.back")}
        className={`${buttonClassName({ variant: "ghost", size: "sm" })} ${styles.mobileBack}`}
        data-testid="work-detail-back"
      >
        <ChevronLeftIcon size={16} aria-hidden="true" />
        {t("common.back")}
      </Link>
      <Heading as="h1" size="page" className={styles.detailTitle}>
        {title}
      </Heading>
    </div>
  );
}
