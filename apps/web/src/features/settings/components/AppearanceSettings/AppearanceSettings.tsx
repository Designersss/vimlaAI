"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Card, Heading, Radio, Text, useAppearance, type Appearance } from "@vimla/ui";
import { SettingsChrome } from "../SettingsChrome/SettingsChrome";

export function AppearanceSettings(): ReactElement {
  const t = useTranslations();
  const { appearance, setAppearance } = useAppearance();

  function option(value: Appearance, label: string): ReactElement {
    return (
      <Radio
        name="appearance"
        value={value}
        checked={appearance === value}
        label={label}
        onChange={() => {
          setAppearance(value);
        }}
      />
    );
  }

  return (
    <SettingsChrome title={t("settings.appearanceTitle")}>
      <Card>
        <Heading as="h2" size="section">
          {t("appearance.theme")}
        </Heading>
        <Text tone="secondary">{t("appearance.description")}</Text>
        {option("light", t("appearance.light"))}
        {option("dark", t("appearance.dark"))}
        {option("system", t("appearance.system"))}
      </Card>
    </SettingsChrome>
  );
}
