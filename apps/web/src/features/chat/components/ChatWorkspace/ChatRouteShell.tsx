"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { ConversationListPane } from "./ConversationListPane";

/** Next-specific navigation adapter; the store has no concept of the selected route. */
export function ChatRouteShell({ children }: { children: ReactNode }): ReactElement {
  const segments = useSelectedLayoutSegments();
  const t = useTranslations();
  const direct = segments[0] === "direct";
  return (
    <MasterDetailLayout
      detailOpen={segments.length > 0}
      masterLabel={t("chat.listPane")}
      detailLabel={t("chat.detailPane")}
      master={<ConversationListPane aiId={direct ? undefined : segments[0]} directId={direct ? segments[1] : undefined} />}
    >
      {children}
    </MasterDetailLayout>
  );
}
