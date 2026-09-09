import type { InputHTMLAttributes, ReactElement, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import styles from "./forms.module.scss";

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export interface InputProps extends NativeInput {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps): ReactElement {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(styles.control, invalid ? styles.invalid : undefined, className)}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }): ReactElement {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(styles.textarea, invalid ? styles.invalid : undefined, className)}
    />
  );
}

export function NativeSelect({
  className,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }): ReactElement {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(styles.select, invalid ? styles.invalid : undefined, className)}
    >
      {children}
    </select>
  );
}
