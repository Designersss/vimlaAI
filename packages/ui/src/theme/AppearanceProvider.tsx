"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  APPEARANCE_COOKIE_NAME,
  appearanceCookieMaxAgeSeconds,
  parseAppearance,
  resolveTheme,
  type Appearance,
  type Density,
  type ResolvedTheme,
} from "./appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  theme: ResolvedTheme;
  density: Density;
  setAppearance: (next: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readCookie(name: string): string | null {
  const encoded = encodeURIComponent(name);
  const match = document.cookie.match(new RegExp(`(?:^|; )${encoded}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function writeAppearanceCookie(appearance: Appearance): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${APPEARANCE_COOKIE_NAME}=${encodeURIComponent(appearance)}; Path=/; Max-Age=${appearanceCookieMaxAgeSeconds()}; SameSite=Lax${secure}`;
}

function applyDom(appearance: Appearance, theme: ResolvedTheme, density: Density): void {
  const root = document.documentElement;
  root.setAttribute("data-appearance", appearance);
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-density", density);
}

export function AppearanceProvider({
  children,
  density = "comfortable",
  initialAppearance = "system",
}: {
  children: ReactNode;
  density?: Density;
  initialAppearance?: Appearance;
}): ReactElement {
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance);
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    setAppearanceState(parseAppearance(readCookie(APPEARANCE_COOKIE_NAME) ?? initialAppearance));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = (): void => {
      setPrefersDark(media.matches);
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
    };
  }, [initialAppearance]);

  const theme = resolveTheme(appearance, prefersDark);

  useEffect(() => {
    applyDom(appearance, theme, density);
  }, [appearance, density, theme]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    writeAppearanceCookie(next);
  }, []);

  const value = useMemo(
    () => ({ appearance, theme, density, setAppearance }),
    [appearance, density, setAppearance, theme],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return value;
}
