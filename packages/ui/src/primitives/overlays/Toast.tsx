"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "../../utils/cx";
import styles from "./overlays.module.scss";

export type ToastVariant = "success" | "info" | "warning" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  publish: (toast: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);

  const publish = useCallback((toast: { title: string; description?: string; variant?: ToastVariant }) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, title: toast.title, description: toast.description, variant: toast.variant ?? "info" }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ publish }), [publish]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.toastRegion} aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={cx(
              styles.toast,
              item.variant === "success" ? styles.toastSuccess : undefined,
              item.variant === "warning" ? styles.toastWarning : undefined,
              item.variant === "error" ? styles.toastError : undefined,
            )}
            role="status"
          >
            <strong>{item.title}</strong>
            {item.description ? <p>{item.description}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}
