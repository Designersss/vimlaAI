import type { ReactElement, ReactNode } from "react";
import { cx } from "../utils/cx";
import styles from "./patterns.module.scss";

export function AppShell({
  sidebar,
  children,
  topbar,
  collapsed = false,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  topbar?: ReactNode;
  collapsed?: boolean;
}): ReactElement {
  return (
    <div className={cx(styles.shell, collapsed ? styles.shellCollapsed : undefined)}>
      <aside className={styles.desktopSidebar}>{sidebar}</aside>
      <div className={styles.main}>
        {topbar ? <div className={cx(styles.topbar, styles.mobileTopbar)}>{topbar}</div> : null}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

export function Sidebar({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.sidebar}>{children}</div>;
}

export function SidebarSection({ label, children }: { label?: string; children: ReactNode }): ReactElement {
  return (
    <div>
      {label ? <p className={styles.sectionLabel}>{label}</p> : null}
      <div className={styles.sidebarNav}>{children}</div>
    </div>
  );
}

export function SidebarItem({
  active,
  children,
  onClick,
  href,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}): ReactElement {
  const className = cx(styles.item, active ? styles.itemActive : undefined);
  if (href) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

export function SidebarFooter({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.footer}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <header className={styles.pageHeader}>
      <div>
        {title}
        {description}
      </div>
      {actions}
    </header>
  );
}

export function PageSection({ children }: { children: ReactNode }): ReactElement {
  return <section>{children}</section>;
}

export function AuthLayout({ children }: { children: ReactNode }): ReactElement {
  return <main className={styles.auth}>{children}</main>;
}

export function AuthCard({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.authCard}>{children}</div>;
}

export function SettingsLayout({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.settings}>
      <nav className={styles.settingsNav}>{navigation}</nav>
      {children}
    </div>
  );
}

export function SettingsNavigation({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.settingsNav}>{children}</div>;
}

export function SettingsSection({ children }: { children: ReactNode }): ReactElement {
  return <section>{children}</section>;
}

export function FilterBar({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.filterBar}>{children}</div>;
}

export function DataTableShell({ children }: { children: ReactNode }): ReactElement {
  return <div>{children}</div>;
}
