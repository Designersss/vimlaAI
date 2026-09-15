import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { LoaderCircleIcon } from "../../icons";
import { cx } from "../../utils/cx";
import styles from "./Button.module.scss";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  children: ReactNode;
}

export function buttonClassName(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}): string {
  const variant = options.variant ?? "primary";
  const size = options.size ?? "md";
  return cx(
    styles.button,
    styles[variant],
    size !== "md" ? styles[size] : undefined,
    options.block ? styles.block : undefined,
    options.className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps): ReactElement {
  const unavailable = Boolean(disabled || loading);

  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, size, block, className })}
      disabled={unavailable}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
    >
      {loading ? <span className={styles.hiddenLabel}>{children}</span> : children}
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <LoaderCircleIcon size={16} />
        </span>
      ) : null}
    </button>
  );
}

export function IconButton({
  variant = "ghost",
  size = "md",
  loading = false,
  className,
  children,
  label,
  type = "button",
  disabled,
  ...props
}: Omit<ButtonProps, "children" | "block"> & { label: string; children: ReactNode }): ReactElement {
  const unavailable = Boolean(disabled || loading);

  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      className={buttonClassName({ variant, size, className: cx(styles.iconButton, className) })}
      disabled={unavailable}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
    >
      <span className={loading ? styles.hiddenIcon : undefined} aria-hidden={loading || undefined}>
        {children}
      </span>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <LoaderCircleIcon size={16} />
        </span>
      ) : null}
    </button>
  );
}
