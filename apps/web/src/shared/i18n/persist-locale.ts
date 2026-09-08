import { LOCALE_COOKIE_NAME, isVimlaLocale, type VimlaLocale } from "@vimla/shared";
import { publicWebConfig } from "../config/public-env";

export function persistLocaleCookie(locale: VimlaLocale): void {
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function readLocaleCookie(): VimlaLocale | null {
  const prefix = `${LOCALE_COOKIE_NAME}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return isVimlaLocale(value) ? value : null;
    }
  }
  return null;
}

export async function persistLocalePreference(locale: VimlaLocale): Promise<void> {
  persistLocaleCookie(locale);
  await fetch(`${publicWebConfig.apiBaseUrl}/v1/me/preferences`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale }),
  }).catch(() => {
    // Logged-out visitors only keep the cookie.
  });
}

export async function syncAuthenticatedLocale(userLocale: VimlaLocale): Promise<void> {
  const cookieLocale = readLocaleCookie();
  if (cookieLocale) {
    await persistLocalePreference(cookieLocale);
    return;
  }
  persistLocaleCookie(userLocale);
}
