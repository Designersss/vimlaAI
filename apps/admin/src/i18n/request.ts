import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_VIMLA_LOCALE,
  LOCALE_COOKIE_NAME,
  localeFromAcceptLanguage,
  parseVimlaLocale,
} from "@vimla/shared";
import { defaultLocale } from "./locales";

export default getRequestConfig(async () => {
  const store = await cookies();
  const headerStore = await headers();
  const cookieLocale = store.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale
    ? parseVimlaLocale(cookieLocale, defaultLocale)
    : localeFromAcceptLanguage(headerStore.get("accept-language"), DEFAULT_VIMLA_LOCALE);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
