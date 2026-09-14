import type { ReactElement, ReactNode } from "react";
import styles from "./MasterDetailLayout.module.scss";

/** Web presentation only. The caller supplies selection, content and accessible pane labels. */
export function MasterDetailLayout({
  master,
  detailOpen,
  masterLabel,
  detailLabel,
  children,
}: {
  master: ReactNode;
  detailOpen: boolean;
  masterLabel: string;
  detailLabel: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.layout} data-detail-open={detailOpen}>
      <section className={styles.master} aria-label={masterLabel}>
        {master}
      </section>
      <section className={styles.detail} aria-label={detailLabel}>
        {children}
      </section>
    </div>
  );
}
