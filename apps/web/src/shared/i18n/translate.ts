import type { useTranslations } from "next-intl";

type Translate = ReturnType<typeof useTranslations>;

export function tx(
  t: Translate,
  key: string,
  values?: Record<string, string | number>,
): string {
  if (values) {
    return t(key as never, values as never);
  }

  return t(key as never);
}
