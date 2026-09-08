"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactElement } from "react";
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
      <button
        type="button"
        className={locale === "ru" ? styles.active : styles.button}
        aria-pressed={locale === "ru"}
        onClick={() => {
          void choose("ru");
        }}
      >
        {t("ru")}
      </button>
      <button
        type="button"
        className={locale === "en" ? styles.active : styles.button}
        aria-pressed={locale === "en"}
        onClick={() => {
          void choose("en");
        }}
      >
        {t("en")}
      </button>
    </div>
  );
}
