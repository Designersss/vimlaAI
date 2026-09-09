export const APPEARANCE_COOKIE_NAME = "vimla_appearance";

export const APPEARANCE_VALUES = ["light", "dark", "system"] as const;

export type Appearance = (typeof APPEARANCE_VALUES)[number];

export type ResolvedTheme = "light" | "dark";

export type Density = "comfortable" | "compact";

export function parseAppearance(value: string | null | undefined): Appearance {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function resolveTheme(appearance: Appearance, prefersDark: boolean): ResolvedTheme {
  if (appearance === "system") {
    return prefersDark ? "dark" : "light";
  }
  return appearance;
}

export function appearanceCookieMaxAgeSeconds(): number {
  return 60 * 60 * 24 * 365;
}

export const APPEARANCE_BOOTSTRAP_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${APPEARANCE_COOKIE_NAME}=([^;]*)/);var a=m?decodeURIComponent(m[1]):"system";if(a!=="light"&&a!=="dark"&&a!=="system")a="system";var t=a==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):a;var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-appearance",a);}catch(e){}})();`;
