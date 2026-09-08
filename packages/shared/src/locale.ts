export const VIMLA_LOCALES = ["ru", "en"] as const;
export type VimlaLocale = (typeof VIMLA_LOCALES)[number];
export const DEFAULT_VIMLA_LOCALE: VimlaLocale = "ru";
export const LOCALE_COOKIE_NAME = "vimla_locale";

export function isVimlaLocale(value: string | null | undefined): value is VimlaLocale {
  return value === "ru" || value === "en";
}

export function parseVimlaLocale(
  value: string | null | undefined,
  fallback: VimlaLocale = DEFAULT_VIMLA_LOCALE,
): VimlaLocale {
  return isVimlaLocale(value) ? value : fallback;
}

export function localeFromAcceptLanguage(
  header: string | null | undefined,
  fallback: VimlaLocale = DEFAULT_VIMLA_LOCALE,
): VimlaLocale {
  if (!header) {
    return fallback;
  }

  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const quality = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag?.trim().toLowerCase() ?? "", quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((item) => item.tag.length > 0)
    .sort((left, right) => right.quality - left.quality);

  for (const candidate of candidates) {
    if (candidate.tag === "ru" || candidate.tag.startsWith("ru-")) {
      return "ru";
    }
    if (candidate.tag === "en" || candidate.tag.startsWith("en-")) {
      return "en";
    }
  }

  return fallback;
}
