import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { SecuritySettings } from "../../../../features/auth/components/SecuritySettings/SecuritySettings";
import { SettingsChrome } from "../../../../features/settings/components/SettingsChrome/SettingsChrome";

export default async function SecurityPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <SettingsChrome title={t("settings.securityTitle")}>
      <SecuritySettings />
    </SettingsChrome>
  );
}
