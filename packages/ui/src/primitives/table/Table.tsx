import type { ReactElement, ReactNode, TableHTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import styles from "./Table.module.scss";

export function Table({
  children,
  className,
  caption,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption?: string }): ReactElement {
  return (
    <div className={styles.scroll} role="region" tabIndex={0} aria-label={caption}>
      <table {...props} className={cx(styles.table, className)}>
        {children}
      </table>
    </div>
  );
}

export function Pagination({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.pagination}>{children}</div>;
}
