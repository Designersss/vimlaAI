import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cx } from "../../utils/cx";
import styles from "./forms.module.scss";

type DescribedControlProps = {
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

function mergeIds(...ids: Array<string | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

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

  const control = isValidElement<DescribedControlProps>(children)
    ? cloneElement(children, {
        "aria-describedby": mergeIds(children.props["aria-describedby"], descriptionId),
        "aria-errormessage": errorId ?? children.props["aria-errormessage"],
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : children;

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
      {control}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
