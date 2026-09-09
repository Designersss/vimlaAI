"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  AppShell,
  Button,
  Drawer,
  IconButton,
  MenuIcon,
  Sidebar,
  SidebarFooter,
  SidebarItem,
  SidebarSection,
  Spinner,
} from "@vimla/ui";
import { adminFetch } from "../../shared/api/admin-fetch";
import { adminAuthClient } from "../../shared/auth/auth-client";
import styles from "./admin.module.scss";

const NAV_GROUPS = [
  {
    label: "overview",
    items: [{ href: "/admin", key: "overview" }],
  },
  {
    label: "finance",
    items: [
      { href: "/admin", key: "financeOverview" },
      { href: "/admin/finance/payments", key: "payments" },
      { href: "/admin/finance/reconciliation", key: "reconciliation" },
      { href: "/admin/finance/payment-fees", key: "paymentFees" },
      { href: "/admin/finance/fiscalization", key: "fiscalization" },
    ],
  },
  {
    label: "tariffs",
    items: [
      { href: "/admin/tariffs", key: "plans" },
      { href: "/admin/tariffs/top-up", key: "topup" },
      { href: "/admin/tariffs/simulator", key: "simulator" },
    ],
  },
  {
    label: "ai",
    items: [
      { href: "/admin/ai", key: "ai" },
      { href: "/admin/ai/usage", key: "aiUsage" },
    ],
  },
  {
    label: "users",
    items: [{ href: "/admin/users", key: "users" }],
  },
  {
    label: "security",
    items: [{ href: "/admin/security", key: "security" }],
  },
  {
    label: "settings",
    items: [{ href: "/admin/settings/economics", key: "economics" }],
  },
] as const;

export function AdminShell({ children }: { children: ReactNode }): ReactNode {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const me = await adminFetch("/admin/v1/auth/me");
      if (me.ok) {
        setReady(true);
        return;
      }
      const identity = await adminAuthClient.getSession();
      if (!identity.data) {
        router.replace("/sign-in");
        return;
      }
      router.replace("/elevate");
    })();
  }, [router]);

  async function logout(): Promise<void> {
    await adminFetch("/admin/v1/auth/logout", { method: "POST" });
    await adminAuthClient.signOut();
    router.replace("/sign-in");
  }

  if (!ready) {
    return <Spinner label={t("app.loading")} />;
  }

  const sidebar = (
    <Sidebar>
      <p className={styles.brand}>{t("app.title")}</p>
      {NAV_GROUPS.map((group) => (
        <SidebarSection key={group.label} label={t(`nav.group.${group.label}`)}>
          {group.items.map((item) => (
            <SidebarItem
              key={`${item.href}-${item.key}`}
              href={item.href}
              active={pathname === item.href}
            >
              {t(`nav.${item.key}`)}
            </SidebarItem>
          ))}
        </SidebarSection>
      ))}
      <SidebarFooter>
        <Button variant="secondary" size="sm" onClick={() => void logout()}>
          {t("app.logout")}
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
            <IconButton label={t("app.openNav")} onClick={() => setNavOpen(true)}>
              <MenuIcon size={18} />
            </IconButton>
            <strong>{t("app.title")}</strong>
          </>
        }
      >
        <main className={styles.main}>{children}</main>
      </AppShell>
      <Drawer open={navOpen} onOpenChange={setNavOpen} title={t("app.title")} closeLabel={t("app.close")}>
        {sidebar}
      </Drawer>
    </>
  );
}
