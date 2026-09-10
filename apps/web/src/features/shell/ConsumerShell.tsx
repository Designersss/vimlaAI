"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CurrentUser } from "@vimla/contracts";
import {
  AppShell,
  Avatar,
  BrandLockup,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  ErrorState,
  GlobalNav,
  LogOutIcon,
  MobileBottomNavigation,
  Sidebar,
  SidebarFooter,
  Spinner,
  VisuallyHidden,
  buttonClassName,
} from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../auth/services/current-user";
import { authClient } from "../auth/services/auth-client";
import { LanguageSwitcher } from "../../shared/i18n/LanguageSwitcher";
import { CanonicalNav } from "./CanonicalNav";
import styles from "./ConsumerShell.module.scss";

export function ConsumerShell({
  children,
  title,
  localNav,
  flush = false,
  requireVerified = true,
}: {
  children: ReactNode;
  title: string;
  localNav?: ReactNode;
  flush?: boolean;
  requireVerified?: boolean;
}): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) {
          return;
        }
        if (requireVerified && !currentUser.emailVerified) {
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
  }, [requireVerified, router]);

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

  const sidebar = (
    <Sidebar>
      <BrandLockup label={t("meta.productName")} />
      <GlobalNav label={t("nav.primary")}>
        <CanonicalNav />
      </GlobalNav>
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
    <AppShell
      sidebar={sidebar}
      topbar={
        <div className={styles.topbar}>
          <p className={styles.title}>{title}</p>
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
      }
      bottomNav={
        <MobileBottomNavigation label={t("nav.primary")}>
          <CanonicalNav compact />
        </MobileBottomNavigation>
      }
    >
      <div className={styles.page} data-testid="consumer-shell">
        {localNav ? <div className={styles.localNav}>{localNav}</div> : null}
        <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
      </div>
    </AppShell>
  );
}

export function LocalNavLink({
  href,
  children,
  active,
}: {
  href: string;
  children: ReactNode;
  active: boolean;
}): ReactElement {
  return (
    <Link href={href} className={buttonClassName({ variant: active ? "primary" : "ghost", size: "sm" })}>
      {children}
    </Link>
  );
}
