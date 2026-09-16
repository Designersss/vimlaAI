import type { ReactElement, ReactNode } from "react";
import { DesktopSectionDock } from "./DesktopSectionDock";
import styles from "./ConsumerShell.module.scss";

/** Page-local composition only; authentication and global navigation live in the route layout. */
export function ConsumerPage({
  children,
  localNav,
  flush = false,
}: {
  children: ReactNode;
  localNav?: ReactNode;
  flush?: boolean;
}): ReactElement {
  return (
    <div className={styles.page}>
      {localNav ? (
        <aside className={styles.localNav}>
          <div className={styles.localNavContent}>{localNav}</div>
          <DesktopSectionDock />
        </aside>
      ) : null}
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
    </div>
  );
}
