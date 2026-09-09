import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "../../icons";
import { cx } from "../../utils/cx";
import styles from "./feedback.module.scss";

export function Alert({
  variant = "info",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "info" | "success" | "warning" | "error" }): ReactElement {
  return (
    <div
      {...props}
      role={variant === "error" ? "alert" : "status"}
      className={cx(
        styles.alert,
        variant === "info" ? styles.alertInfo : undefined,
        variant === "success" ? styles.alertSuccess : undefined,
        variant === "warning" ? styles.alertWarning : undefined,
        variant === "error" ? styles.alertError : undefined,
        className,
      )}
    >
      <AlertCircleIcon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: "neutral" | "accent" | "success" | "warning" | "danger" | "locked";
  children: ReactNode;
}): ReactElement {
  return (
    <span
      className={cx(
        styles.badge,
        variant === "accent" ? styles.badgeAccent : undefined,
        variant === "success" ? styles.badgeSuccess : undefined,
        variant === "warning" ? styles.badgeWarning : undefined,
        variant === "danger" ? styles.badgeDanger : undefined,
        variant === "locked" ? styles.badgeLocked : undefined,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}): ReactElement {
  const variant = tone === "neutral" ? "neutral" : tone;
  return <Badge variant={variant}>{children}</Badge>;
}

export function Avatar({
  name,
  src,
}: {
  name: string;
  src?: string | null;
}): ReactElement {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={styles.avatar} title={name}>
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}

export function AvatarGroup({ children }: { children: ReactNode }): ReactElement {
  return <span className={styles.avatarGroup}>{children}</span>;
}

export function Progress({ value, label }: { value: number; label?: string }): ReactElement {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.progress} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span className={styles.progressBar} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function UsageMeter({
  label,
  percent,
  caption,
}: {
  label: string;
  percent: number;
  caption?: string;
}): ReactElement {
  return (
    <div className={styles.usage}>
      <span>{label}</span>
      <Progress value={percent} label={label} />
      <span>{caption ?? `${percent}%`}</span>
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <section className={cx(styles.card, className)}>{children}</section>;
}

export function Skeleton({ className }: { className?: string }): ReactElement {
  return <span className={cx(styles.skeleton, className)} />;
}

export function Spinner({ label }: { label: string }): ReactElement {
  return (
    <span className={styles.spinner} role="status" aria-label={label}>
      <LoaderCircleIcon size={18} aria-hidden="true" />
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <Alert variant="error">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </Alert>
  );
}

export function Divider(): ReactElement {
  return <hr className={styles.divider} />;
}

export function VisuallyHidden({ children }: { children: ReactNode }): ReactElement {
  return <span className={styles.visuallyHidden}>{children}</span>;
}
