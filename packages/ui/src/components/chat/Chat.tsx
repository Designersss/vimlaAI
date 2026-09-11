import type { FormEvent, ReactElement, ReactNode } from "react";
import { ChevronRightIcon, SendIcon, VimlaMark, XIcon } from "../../icons";
import { IconButton, Button } from "../../primitives/Button/Button";
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

export function VimlaMentionChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
}): ReactElement {
  return (
    <span className={styles.mentionChip}>
      <VimlaMark size={12} />
      {label}
      {onRemove && removeLabel ? (
        <IconButton label={removeLabel} size="sm" onClick={onRemove}>
          <XIcon size={12} />
        </IconButton>
      ) : null}
    </span>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  sendLabel,
  disabled,
  sending,
  extra,
  mentionControl,
  modelControl,
  chips,
  variant = "ai",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  sending?: boolean;
  extra?: ReactNode;
  mentionControl?: ReactNode;
  modelControl?: ReactNode;
  chips?: ReactNode;
  variant?: "ai" | "direct" | "operator";
}): ReactElement {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.composer} onSubmit={handleSubmit} data-composer-variant={variant}>
      {chips ? <div className={styles.chipRow}>{chips}</div> : null}
      <Textarea
        className={styles.composerField}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
      />
      <div className={styles.composerActions}>
        {mentionControl}
        {variant === "operator" ? null : modelControl}
        {extra}
        <span className={styles.composerGrow} />
        <IconButton type="submit" variant="primary" disabled={disabled || sending} loading={sending} label={sendLabel}>
          <SendIcon size={16} aria-hidden="true" />
        </IconButton>
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
    <article className={cx(styles.message, styles.messageUser)}>
      <p className={styles.role}>{label}</p>
      <p className={cx(styles.bubble, styles.bubbleUser)}>{children}</p>
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
      <p className={cx(styles.bubble)}>{children}</p>
    </article>
  );
}

export function AttachmentCard({
  name,
  meta,
  trailing,
}: {
  name: string;
  meta?: string;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <div className={styles.attachment}>
      <div className={styles.projectMeta}>
        <strong>{name}</strong>
        {meta ? <Text tone="caption">{meta}</Text> : null}
      </div>
      {trailing}
    </div>
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

export function OperatorActionCard({
  title,
  detail,
  statusLabel,
  tone = "neutral",
  hrefLabel,
  onOpen,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  processing = false,
}: {
  title: string;
  detail?: string | null;
  statusLabel: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  hrefLabel?: string;
  onOpen?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  processing?: boolean;
}): ReactElement {
  return (
    <article className={styles.operatorCard} data-tone={tone} data-testid="operator-action-card">
      <div className={styles.operatorCardBody}>
        <Badge
          variant={tone === "success" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "accent"}
        >
          {statusLabel}
        </Badge>
        <strong>{title}</strong>
        {detail ? <Text tone="caption">{detail}</Text> : null}
      </div>
      <div className={styles.operatorCardActions}>
        {onOpen && hrefLabel ? (
          <IconButton label={hrefLabel} onClick={onOpen}>
            <ChevronRightIcon size={16} />
          </IconButton>
        ) : null}
        {onConfirm && confirmLabel ? (
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={processing} loading={processing}>
            {confirmLabel}
          </Button>
        ) : null}
        {onCancel && cancelLabel ? (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={processing}>
            {cancelLabel}
          </Button>
        ) : null}
      </div>
    </article>
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
export type AutoEffortLevel = "minimum" | "medium" | "maximum";

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

export function ProjectLocalNav({ children, label }: { children: ReactNode; label: string }): ReactElement {
  return (
    <nav aria-label={label} className={styles.filters}>
      {children}
    </nav>
  );
}
