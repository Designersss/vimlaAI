import type { ReactElement, ReactNode } from "react";
import { cx } from "../../utils/cx";
import styles from "./forms.module.scss";

export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cx(styles.stack, className)}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
