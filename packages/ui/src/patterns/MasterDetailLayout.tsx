import type { ReactElement, ReactNode } from "react";
import styles from "./MasterDetailLayout.module.scss";

/** Web presentation only. The caller supplies selection, content and accessible pane labels. */
export function MasterDetailLayout({
  master,
  masterFooter,
  detailOpen,
  masterLabel,
  detailLabel,
  children,
}: {
  master: ReactNode;
  masterFooter?: ReactNode;
  detailOpen: boolean;
  masterLabel: string;
  detailLabel: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.layout} data-detail-open={detailOpen}>
      <div className={styles.master}>
        <section className={styles.masterContent} aria-label={masterLabel}>
          {master}
        </section>
        {masterFooter ? <div className={styles.masterFooter}>{masterFooter}</div> : null}
      </div>
      <section className={styles.detail} aria-label={detailLabel}>
        {children}
      </section>
    </div>
  );
}
