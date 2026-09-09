"use client";

import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button } from "../Button/Button";
import styles from "./overlays.module.scss";

export function DropdownMenu({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    function onPointer(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.anchor}>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <div id={menuId} role="menu" className={styles.menu}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.menuItem}
      onClick={() => {
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    function onPointer(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onOpenChange]);

  return (
    <div ref={rootRef} className={styles.anchor}>
      {trigger}
      {open ? <div className={styles.menu}>{children}</div> : null}
    </div>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={styles.tooltipWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span role="tooltip" className={styles.tooltip}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
