import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { cx } from "../../utils/cx";
import styles from "./typography.module.scss";

export function Heading({
  as: Tag = "h1",
  size = "page",
  children,
  className,
}: {
  as?: "h1" | "h2" | "h3";
  size?: "page" | "section" | "sub";
  children: ReactNode;
  className?: string;
}): ReactElement {
  const sizeClass = size === "page" ? styles.headingPage : size === "section" ? styles.headingSection : styles.headingSub;
  return <Tag className={cx(sizeClass, className)}>{children}</Tag>;
}

export function Text({
  tone = "body",
  as: Tag = "p",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  tone?: "body" | "secondary" | "caption";
  as?: "p" | "span" | "div";
  children: ReactNode;
}): ReactElement {
  const toneClass =
    tone === "secondary" ? styles.textSecondary : tone === "caption" ? styles.textCaption : styles.textBody;
  return (
    <Tag {...props} className={cx(toneClass, className)}>
      {children}
    </Tag>
  );
}
