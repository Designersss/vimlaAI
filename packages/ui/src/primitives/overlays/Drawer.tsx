"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { XIcon } from "../../icons";
import { cx } from "../../utils/cx";
import { IconButton } from "../Button/Button";
import styles from "./overlays.module.scss";

export type DrawerPlacement = "left" | "right" | "bottom";

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  closeLabel,
  placement = "left",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  closeLabel: string;
  placement?: DrawerPlacement;
}): ReactElement | null {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
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
    <>
      <div className={styles.drawerOverlay} onClick={() => onOpenChange(false)} />
      <aside
        ref={setPanel}
        className={
          placement === "bottom"
            ? styles.sheet
            : cx(styles.drawer, placement === "right" ? styles.drawerRight : undefined)
        }
        role="dialog"
        aria-modal="true"
        aria-label={String(title)}
      >
        <div className={styles.header}>
          <strong>{title}</strong>
          <IconButton label={closeLabel} onClick={() => onOpenChange(false)}>
            <XIcon size={16} />
          </IconButton>
        </div>
        {children}
      </aside>
    </>,
    document.body,
  );
}

export function Sheet(
  props: Omit<Parameters<typeof Drawer>[0], "placement">,
): ReactElement | null {
  return <Drawer {...props} placement="bottom" />;
}
