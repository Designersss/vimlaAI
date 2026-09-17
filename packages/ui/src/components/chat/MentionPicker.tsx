import type { ReactElement } from "react";
import { Avatar } from "../../primitives/feedback/Feedback";
import styles from "./mention-picker.module.scss";

export interface MentionPickerOption {
  id: string;
  handle: string;
  label: string;
  description?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
}

export interface MentionPickerSection {
  id: string;
  label: string;
  options: MentionPickerOption[];
}

export function MentionPicker({
  open,
  sections,
  activeId,
  ariaLabel,
  emptyLabel,
  onSelect,
}: {
  open: boolean;
  sections: MentionPickerSection[];
  activeId?: string | null;
  ariaLabel: string;
  emptyLabel: string;
  onSelect: (option: MentionPickerOption) => void;
}): ReactElement | null {
  if (!open) return null;
  const hasOptions = sections.some((section) => section.options.length > 0);

  return (
    <div className={styles.picker} role="listbox" aria-label={ariaLabel} data-testid="mention-picker">
      {hasOptions ? (
        sections.map((section) =>
          section.options.length > 0 ? (
            <section key={section.id} className={styles.section} aria-labelledby={`mention-section-${section.id}`}>
              <p id={`mention-section-${section.id}`} className={styles.sectionLabel}>
                {section.label}
              </p>
              <div className={styles.options}>
                {section.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === activeId}
                    className={styles.option}
                    data-active={option.id === activeId || undefined}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(option)}
                  >
                    {option.avatarUrl ? <Avatar name={option.label} src={option.avatarUrl} /> : null}
                    <span className={styles.copy}>
                      <strong>{option.label}</strong>
                      <span className={styles.handle}>@{option.handle}</span>
                      {option.description ? <span className={styles.description}>{option.description}</span> : null}
                    </span>
                    {option.role ? <span className={styles.role}>{option.role}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null,
        )
      ) : (
        <p className={styles.empty}>{emptyLabel}</p>
      )}
    </div>
  );
}
