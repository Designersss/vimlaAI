import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { AccountSettings } from "../../../features/settings/components/AccountSettings/AccountSettings";
import { SettingsChrome } from "../../../features/settings/components/SettingsChrome/SettingsChrome";

export default async function AccountPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <SettingsChrome title={t("settings.accountTitle")}>
      <AccountSettings />
    </SettingsChrome>
  );
}
