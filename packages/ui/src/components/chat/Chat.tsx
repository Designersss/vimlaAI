import type { FormEvent, ReactElement, ReactNode } from "react";
import { SendIcon } from "../../icons";
import { Button } from "../../primitives/Button/Button";
import { Textarea } from "../../primitives/forms/Input";
import { Segment, SegmentedControl } from "../../primitives/controls/Tabs";
import { NativeSelect } from "../../primitives/forms/Input";
import { Badge } from "../../primitives/feedback/Feedback";
import { Avatar, AvatarGroup } from "../../primitives/feedback/Feedback";
import { Card } from "../../primitives/feedback/Feedback";
import { SidebarItem } from "../../patterns/AppShell";
import { Text } from "../../primitives/typography/Typography";
import { cx } from "../../utils/cx";
import styles from "./chat.module.scss";

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  sendLabel,
  disabled,
  sending,
  extra,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  sending?: boolean;
  extra?: ReactNode;
}): ReactElement {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        disabled={disabled}
      />
      <div className={styles.composerActions}>
        {extra}
        <Button type="submit" disabled={disabled || sending} loading={sending}>
          <SendIcon size={16} aria-hidden="true" />
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}

export function UserMessage({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <article className={styles.message}>
      <p className={cx(styles.role, styles.userRole)}>{label}</p>
      <p className={styles.content}>{children}</p>
    </article>
  );
}

export function AssistantMessage({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <article className={styles.message}>
      <p className={styles.role}>{label}</p>
      <p className={styles.content}>{children}</p>
    </article>
  );
}

export function StreamingIndicator({ label }: { label: string }): ReactElement {
  return (
    <span className={styles.stream} role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

export function ConversationItem({
  title,
  active,
  onSelect,
}: {
  title: string;
  active?: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <SidebarItem active={active} onClick={onSelect}>
      {title}
    </SidebarItem>
  );
}

export type AiInteractionMode = "pro" | "auto";

export function AiModeSelector({
  mode,
  onModeChange,
  label,
  proLabel,
  autoLabel,
  autoEnabled = false,
  autoHint,
  proControl,
}: {
  mode: AiInteractionMode;
  onModeChange: (mode: AiInteractionMode) => void;
  label: string;
  proLabel: string;
  autoLabel: string;
  autoEnabled?: boolean;
  autoHint?: string;
  proControl?: ReactNode;
}): ReactElement {
  return (
    <div>
      <SegmentedControl label={label}>
        <Segment checked={mode === "pro"} onSelect={() => onModeChange("pro")}>
          {proLabel}
        </Segment>
        <Segment
          checked={mode === "auto"}
          disabled={!autoEnabled}
          onSelect={() => {
            if (autoEnabled) {
              onModeChange("auto");
            }
          }}
        >
          {autoLabel}
        </Segment>
      </SegmentedControl>
      {mode === "pro" ? proControl : null}
      {autoHint && (!autoEnabled || mode === "auto") ? <Text tone="caption">{autoHint}</Text> : null}
    </div>
  );
}

export function ModelSelector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}): ReactElement {
  return (
    <label>
      {label}
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

export function ProjectStatusBadge({
  status,
  label,
}: {
  status: "active" | "locked" | "archived";
  label: string;
}): ReactElement {
  const variant = status === "locked" ? "locked" : status === "archived" ? "neutral" : "accent";
  return <Badge variant={variant}>{label}</Badge>;
}

export function PlanLockedBanner({ title, description }: { title: string; description: string }): ReactElement {
  return (
    <Card>
      <Text>{title}</Text>
      <Text tone="secondary">{description}</Text>
    </Card>
  );
}

export function ProjectListItem({
  title,
  meta,
  status,
}: {
  title: string;
  meta?: string;
  status?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.projectCard}>
      <strong>{title}</strong>
      <div className={styles.projectMeta}>
        {status}
        {meta ? <Text tone="caption">{meta}</Text> : null}
      </div>
    </div>
  );
}

export function ProjectCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Card>
      <strong>{title}</strong>
      {children}
    </Card>
  );
}

export function MemberAvatarGroup({ names }: { names: string[] }): ReactElement {
  return (
    <AvatarGroup>
      {names.map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </AvatarGroup>
  );
}

export function ProjectWorkspaceHeader({ title, actions }: { title: string; actions?: ReactNode }): ReactElement {
  return (
    <header className={styles.projectMeta}>
      <strong>{title}</strong>
      {actions}
    </header>
  );
}
