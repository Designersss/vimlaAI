import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@vimla/ui";

export default async function AppHomePage(): Promise<ReactElement> {
  const t = await getTranslations();
  return <EmptyState title={t("chat.selectConversation")} />;
}
