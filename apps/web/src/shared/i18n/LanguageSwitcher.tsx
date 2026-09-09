"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactElement } from "react";
import { Button } from "@vimla/ui";
import { persistLocalePreference } from "../../shared/i18n/persist-locale";
import type { VimlaLocale } from "@vimla/shared";
import { useRouter } from "next/navigation";
import styles from "./LanguageSwitcher.module.scss";

export function LanguageSwitcher(): ReactElement {
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  async function choose(next: VimlaLocale): Promise<void> {
    if (next === locale) {
      return;
    }
    await persistLocalePreference(next);
    router.refresh();
  }

  return (
    <div className={styles.group} role="group" aria-label={t("label")}>
      <Button
        type="button"
        size="sm"
        variant={locale === "ru" ? "primary" : "ghost"}
        aria-pressed={locale === "ru"}
        onClick={() => {
          void choose("ru");
        }}
      >
        {t("ru")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={locale === "en" ? "primary" : "ghost"}
        aria-pressed={locale === "en"}
        onClick={() => {
          void choose("en");
        }}
      >
        {t("en")}
      </Button>
    </div>
  );
}
