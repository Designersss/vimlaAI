"use client";

import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, container: HTMLElement | null): void {
  useEffect(() => {
    if (!active || !container) {
      return;
    }
    const previouslyFocused = document.activeElement;
    const nodes = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true",
      );

    const first = nodes()[0];
    first?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") {
        return;
      }
      const items = nodes();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) {
        return;
      }
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [active, container]);
}
