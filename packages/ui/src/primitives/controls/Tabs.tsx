import type { ReactElement, ReactNode } from "react";
import { cx } from "../../utils/cx";
import styles from "./controls.module.scss";

export function Tabs({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cx(styles.tabs, className)} role="tablist" aria-label={label}>
      {children}
    </div>
  );
}

export function Tab({
  selected,
  children,
  onSelect,
  disabled,
}: {
  selected: boolean;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button type="button" role="tab" aria-selected={selected} disabled={disabled} className={styles.tab} onClick={onSelect}>
      {children}
    </button>
  );
}

export function SegmentedControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}

export function Segment({
  checked,
  children,
  onSelect,
  disabled,
}: {
  checked: boolean;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      className={styles.segment}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
