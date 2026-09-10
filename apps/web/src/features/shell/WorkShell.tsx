"use client";

import type { ReactElement, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NotificationBell } from "../notifications/components/NotificationBell";
import { ConsumerShell, LocalNavLink } from "./ConsumerShell";

export function WorkShell({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <ConsumerShell
      title={t("nav.work")}
      actions={<NotificationBell />}
      localNav={
        <nav aria-label={t("nav.work")}>
          <LocalNavLink href="/work" active={pathname === "/work"}>
            {t("work.today")}
          </LocalNavLink>
          <LocalNavLink href="/work/tasks" active={pathname.startsWith("/work/tasks")}>
            {t("work.tasks")}
          </LocalNavLink>
          <LocalNavLink href="/work/reminders" active={pathname.startsWith("/work/reminders")}>
            {t("work.reminders")}
          </LocalNavLink>
          <LocalNavLink href="/work/lists" active={pathname.startsWith("/work/lists")}>
            {t("work.lists")}
          </LocalNavLink>
          <LocalNavLink href="/work/notes" active={pathname.startsWith("/work/notes")}>
            {t("work.notes")}
          </LocalNavLink>
        </nav>
      }
    >
      <div data-testid="work-shell">{children}</div>
    </ConsumerShell>
  );
}
