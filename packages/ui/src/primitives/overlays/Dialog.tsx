"use client";

import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { XIcon } from "../../icons";
import { IconButton } from "../Button/Button";
import styles from "./overlays.module.scss";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  closeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
}): ReactElement | null {
  const titleId = useId();
  const descriptionId = useId();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useFocusTrap(open, panel);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onOpenChange, open]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        ref={setPanel}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className={styles.header}>
          <div>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label={closeLabel} onClick={() => onOpenChange(false)}>
            <XIcon size={16} />
          </IconButton>
        </div>
        {children}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export const Modal = Dialog;
