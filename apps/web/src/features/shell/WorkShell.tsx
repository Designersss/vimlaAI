"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import {
  AppShell,
  Button,
  Drawer,
  ErrorState,
  IconButton,
  LogOutIcon,
  MenuIcon,
  Sidebar,
  SidebarFooter,
  Spinner,
  buttonClassName,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../auth/services/current-user";
import { authClient } from "../auth/services/auth-client";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import { CanonicalNav } from "./CanonicalNav";
import styles from "./WorkShell.module.scss";

export function WorkShell({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) {
          return;
        }
        if (!currentUser.emailVerified) {
          router.replace("/verify-email");
          return;
        }
        setUser(currentUser);
        setBoot("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  if (boot === "loading") {
    return (
      <p className={styles.status}>
        <Spinner label={t("work.loading")} />
      </p>
    );
  }

  if (boot === "failed" || !user) {
    return <ErrorState title={t("work.failed")} />;
  }

  const sidebar = (
    <Sidebar>
      <p className={styles.brand}>{t("meta.productName")}</p>
      <div className={styles.canonical}>
        <CanonicalNav />
      </div>
      <SidebarFooter>
        <LanguageSwitcher />
        <p className={styles.user}>{user.email}</p>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOutIcon size={16} aria-hidden="true" />
          {t("nav.signOut")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );

  return (
    <>
      <AppShell
        sidebar={sidebar}
        topbar={
          <>
            <IconButton label={t("work.openMenu")} onClick={() => setNavOpen(true)}>
              <MenuIcon size={18} />
            </IconButton>
            <strong>{t("nav.work")}</strong>
          </>
        }
      >
        <div data-testid="work-shell">
          <nav className={styles.subnav} aria-label={t("nav.work")}>
            {subnav("/work", t("work.today"), pathname === "/work")}
            {subnav("/work/tasks", t("work.tasks"), pathname.startsWith("/work/tasks"))}
            {subnav("/work/reminders", t("work.reminders"), pathname.startsWith("/work/reminders"))}
            {subnav("/work/lists", t("work.lists"), pathname.startsWith("/work/lists"))}
            {subnav("/work/notes", t("work.notes"), pathname.startsWith("/work/notes"))}
          </nav>
          <div className={styles.page}>{children}</div>
        </div>
      </AppShell>
      <Drawer open={navOpen} onOpenChange={setNavOpen} title={t("nav.work")} closeLabel={t("common.close")}>
        {sidebar}
      </Drawer>
    </>
  );
}

function subnav(href: string, label: string, active: boolean): ReactElement {
  return (
    <Link href={href} className={buttonClassName({ variant: active ? "primary" : "ghost", size: "sm" })}>
      {label}
    </Link>
  );
}
