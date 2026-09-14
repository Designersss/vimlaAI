import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Avatar, Badge } from "../../primitives/feedback/Feedback";
import { Text } from "../../primitives/typography/Typography";
import styles from "./rows.module.scss";

export function BaseListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  href,
  onClick,
  selected,
  disabled,
  testId,
  renderLink,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  testId?: string;
  renderLink?: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => ReactNode;
}): ReactElement {
  const className = cx(styles.row, selected ? styles.selected : undefined, disabled ? styles.disabled : undefined);
  const body = (
    <>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </>
  );

  if (href && !disabled) {
    if (renderLink) {
      return <>{renderLink({
        href,
        className,
        children: body,
        "aria-current": selected ? "page" : undefined,
        ...{ "data-testid": testId },
      })}</>;
    }
    return (
      <a className={className} href={href} data-testid={testId}>
        {body}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled} data-testid={testId}>
      {body}
    </button>
  );
}

export function AIConversationRow(props: {
  title: string;
  preview?: string;
  time?: string;
  unreadCount?: number;
  href?: string;
  onSelect?: () => void;
  renderLink?: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => ReactNode;
  selected?: boolean;
  leading?: ReactNode;
}): ReactElement {
  return (
    <BaseListRow
      leading={props.leading}
      title={props.title}
      subtitle={props.preview}
      meta={props.time}
      trailing={props.unreadCount ? <Badge variant="accent">{props.unreadCount}</Badge> : undefined}
      href={props.href}
      onClick={props.onSelect}
      selected={props.selected}
      renderLink={props.renderLink}
    />
  );
}

export function DirectConversationRow(props: {
  name: string;
  preview?: string;
  time?: string;
  unreadCount?: number;
  href?: string;
  onSelect?: () => void;
  renderLink?: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => ReactNode;
  selected?: boolean;
}): ReactElement {
  return (
    <BaseListRow
      leading={<Avatar name={props.name} />}
      title={props.name}
      subtitle={props.preview}
      meta={props.time}
      trailing={props.unreadCount ? <Badge variant="accent">{props.unreadCount}</Badge> : undefined}
      href={props.href}
      onClick={props.onSelect}
      selected={props.selected}
      renderLink={props.renderLink}
      testId="direct-conversation-row"
    />
  );
}

export function FolderRow(props: { title: string; meta?: string; href?: string; onSelect?: () => void }): ReactElement {
  return <BaseListRow title={props.title} subtitle={props.meta} href={props.href} onClick={props.onSelect} />;
}

export function TaskRow(props: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.staticRow}>
      {props.leading}
      <span className={styles.main}>
        <span className={styles.title}>{props.title}</span>
        {props.subtitle ? <span className={styles.subtitle}>{props.subtitle}</span> : null}
      </span>
      {props.badge}
      {props.trailing}
    </div>
  );
}

export function ReminderRow(props: { title: string; subtitle?: string; trailing?: ReactNode }): ReactElement {
  return (
    <div className={styles.staticRow}>
      <span className={styles.main}>
        <span className={styles.title}>{props.title}</span>
        {props.subtitle ? <span className={styles.subtitle}>{props.subtitle}</span> : null}
      </span>
      {props.trailing}
    </div>
  );
}

export function ListRow(props: {
  title: string;
  subtitle?: string;
  href?: string;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <BaseListRow title={props.title} subtitle={props.subtitle} href={props.href} trailing={props.trailing} />
  );
}

export function NoteRow(props: { title: string; subtitle?: string; href?: string; meta?: string }): ReactElement {
  return <BaseListRow title={props.title} subtitle={props.subtitle} meta={props.meta} href={props.href} />;
}

export function ProjectRow(props: {
  title: string;
  subtitle?: string;
  members?: ReactNode;
  href?: string;
}): ReactElement {
  return <BaseListRow title={props.title} subtitle={props.subtitle} trailing={props.members} href={props.href} />;
}

export function ConversationHeader({
  title,
  subtitle,
  back,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: ReactNode;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <header className={styles.header}>
      {back}
      <div className={styles.main}>
        <Text as="div">{title}</Text>
        {subtitle ? (
          <Text tone="caption" as="div">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {trailing}
    </header>
  );
}

export function rowActionClassName(): string {
  return styles.staticRow ?? "";
}

export type RowButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
