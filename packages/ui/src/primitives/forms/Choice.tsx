import type { InputHTMLAttributes, ReactElement, ReactNode } from "react";
import styles from "./forms.module.scss";

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }): ReactElement {
  return (
    <label className={styles.check}>
      <input {...props} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}

export function Radio({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }): ReactElement {
  return (
    <label className={styles.radio}>
      <input {...props} type="radio" />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }): ReactElement {
  return (
    <label className={styles.switch}>
      <input {...props} type="checkbox" role="switch" />
      <span className={styles.track} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
