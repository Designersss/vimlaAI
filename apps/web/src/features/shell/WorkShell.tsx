"use client";

import type { ReactElement, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { WorkspaceViewSyncProvider } from "../workspace/components/WorkspaceViewSync";
import { LocalNavLink } from "./ConsumerShell";
import { ConsumerPage } from "./ConsumerPage";
import styles from "./WorkShell.module.scss";

export function WorkShell({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <WorkspaceViewSyncProvider>
      <ConsumerPage
        localNav={
          <nav aria-label={t("nav.work")} data-testid="work-navigation">
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
        <div className={styles.root} data-testid="work-shell">
          {children}
        </div>
      </ConsumerPage>
    </WorkspaceViewSyncProvider>
  );
}
