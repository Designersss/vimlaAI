import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { BillingSettings } from "../../../features/billing/components/BillingSettings/BillingSettings";
import { SettingsChrome } from "../../../features/settings/components/SettingsChrome/SettingsChrome";

export default async function BillingPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <SettingsChrome title={t("billing.title")}>
      <BillingSettings />
    </SettingsChrome>
  );
}
