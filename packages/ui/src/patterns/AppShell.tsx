import type { ReactElement, ReactNode } from "react";
import { cx } from "../utils/cx";
import { VimlaMark } from "../icons/VimlaMark";
import styles from "./patterns.module.scss";

export function AppShell({
  sidebar,
  children,
  topbar,
  collapsed = false,
  bottomNav,
  viewport = false,
  topbarVisibility = "mobile",
}: {
  sidebar: ReactNode;
  children: ReactNode;
  topbar?: ReactNode;
  collapsed?: boolean;
  bottomNav?: ReactNode;
  viewport?: boolean;
  topbarVisibility?: "mobile" | "all";
}): ReactElement {
  return (
    <div className={cx(styles.shell, viewport ? styles.viewport : undefined, collapsed ? styles.shellCollapsed : undefined)}>
      <aside className={styles.desktopSidebar}>{sidebar}</aside>
      <div className={styles.main}>
        {topbar ? <div className={cx(styles.topbar, topbarVisibility === "mobile" ? styles.mobileTopbar : undefined)}>{topbar}</div> : null}
        <div className={cx(styles.content, bottomNav ? styles.mobileContentPad : undefined)}>{children}</div>
      </div>
      {bottomNav}
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

export function sidebarItemClassName(options: {
  active?: boolean;
  brand?: boolean;
  disabled?: boolean;
  className?: string;
}): string {
  return cx(
    styles.item,
    options.active ? styles.itemActive : undefined,
    options.brand ? styles.itemBrand : undefined,
    options.disabled ? styles.itemDisabled : undefined,
    options.className,
  );
}

export function SidebarItem({
  active,
  children,
  onClick,
  href,
  brand,
  disabled,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  brand?: boolean;
  disabled?: boolean;
}): ReactElement {
  const className = sidebarItemClassName({ active, brand, disabled });
  if (href && !disabled) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SidebarFooter({ children }: { children: ReactNode }): ReactElement {
  return <div className={styles.footer}>{children}</div>;
}

export function BrandLockup({ label }: { label: string }): ReactElement {
  return (
    <div className={styles.brandRow}>
      <span className={styles.brandMark}>
        <VimlaMark size={22} />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function GlobalNav({ children, label }: { children: ReactNode; label: string }): ReactElement {
  return (
    <nav className={styles.globalNav} aria-label={label}>
      {children}
    </nav>
  );
}

export function MobileBottomNavigation({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}): ReactElement {
  return (
    <nav className={styles.bottomNav} aria-label={label}>
      {children}
    </nav>
  );
}

export function mobileNavItemClassName(options: {
  active?: boolean;
  brand?: boolean;
  className?: string;
}): string {
  return cx(
    styles.bottomItem,
    options.active ? styles.bottomItemActive : undefined,
    options.brand ? styles.bottomItemBrand : undefined,
    options.className,
  );
}

export function MobileNavItem({
  href,
  active,
  brand,
  icon,
  label,
}: {
  href: string;
  active?: boolean;
  brand?: boolean;
  icon: ReactNode;
  label: string;
}): ReactElement {
  return (
    <a href={href} className={mobileNavItemClassName({ active, brand })}>
      {icon}
      <span className={styles.bottomLabel}>{label}</span>
    </a>
  );
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

export function AuthLayout({ children, panel }: { children: ReactNode; panel?: ReactNode }): ReactElement {
  return (
    <main className={styles.auth}>
      <div className={styles.authMain}>{children}</div>
      {panel ? (
        <aside className={styles.authPanel}>
          <div className={styles.authPanelInner}>{panel}</div>
        </aside>
      ) : null}
    </main>
  );
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
