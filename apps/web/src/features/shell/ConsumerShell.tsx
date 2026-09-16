"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import {
  AppShell,
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  ErrorState,
  LogOutIcon,
  MobileBottomNavigation,
  Spinner,
  VisuallyHidden,
  buttonClassName,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../auth/services/current-user";
import { authClient } from "../auth/services/auth-client";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import { CanonicalNav } from "./CanonicalNav";
import { NotificationBell } from "../notifications/components/NotificationBell";
import { readLocaleCookie, syncAuthenticatedLocale } from "../../shared/i18n/persist-locale";
import styles from "./ConsumerShell.module.scss";

export function ConsumerShell({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const title = pathname.startsWith("/work") ? t("nav.work")
    : pathname.startsWith("/projects") ? t("nav.projects")
    : pathname.startsWith("/settings") ? t("nav.settings")
    : pathname.startsWith("/vimla") ? t("nav.vimla") : t("nav.messages");
  const viewport = pathname === "/app" || pathname.startsWith("/app/")
    || pathname === "/projects" || pathname.startsWith("/projects/")
    || pathname === "/settings" || pathname.startsWith("/settings/")
    || pathname === "/work" || pathname.startsWith("/work/");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then(async (currentUser) => {
        if (cancelled) return;
        if (!currentUser.emailVerified) {
          router.replace("/verify-email");
          return;
        }
        await syncAuthenticatedLocale(currentUser.locale);
        if (cancelled) return;
        const cookieLocale = readLocaleCookie();
        if (cookieLocale && cookieLocale !== locale) router.refresh();
        setUser(currentUser);
        setBoot("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setBoot("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [locale, router]);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  if (boot === "loading") {
    return (
      <p className={styles.status}>
        <Spinner label={t("common.loading")} />
      </p>
    );
  }

  if (boot === "failed" || !user) {
    return <ErrorState title={t("common.genericError")} />;
  }

  return (
    <AppShell
      viewport={viewport}
      topbarVisibility="all"
      topbar={
        <div className={styles.topbar}>
          <p className={styles.title}>{title}</p>
          <div className={styles.actions}>
            <LanguageSwitcher />
            <NotificationBell />
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOutIcon size={16} aria-hidden="true" />
              {t("nav.signOut")}
            </Button>
            <DropdownMenu
              label={
                <>
                  <Avatar name={user.name || user.email} />
                  <VisuallyHidden>{t("nav.settings")}</VisuallyHidden>
                </>
              }
              variant="ghost"
            >
              <DropdownMenuItem onSelect={() => router.push("/settings/account")}>
                {t("nav.settings")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void signOut()}>{t("nav.signOut")}</DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>
      }
      bottomNav={
        <MobileBottomNavigation label={t("nav.primary")}>
          <CanonicalNav compact />
        </MobileBottomNavigation>
      }
    >
      <main className={styles.page} data-testid="consumer-shell">{children}</main>
    </AppShell>
  );
}

export function LocalNavLink({
  href,
  children,
  active,
  disabled = false,
}: {
  href: string;
  children: ReactNode;
  active: boolean;
  disabled?: boolean;
}): ReactElement {
  if (disabled) {
    return (
      <span className={buttonClassName({ variant: "ghost", size: "sm" })} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={buttonClassName({ variant: active ? "primary" : "ghost", size: "sm" })}
    >
      {children}
    </Link>
  );
}
