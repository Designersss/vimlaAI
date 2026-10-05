"use client";

import type { ReactElement, ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { useTranslations } from "next-intl";
import { MasterDetailLayout } from "@vimla/ui";
import { DesktopSectionDock } from "../../../shell/DesktopSectionDock";
import { ConversationListPane } from "./ConversationListPane";

/** Next-specific navigation adapter; the store has no concept of the selected route. */
export function ChatRouteShell({ children }: { children: ReactNode }): ReactElement {
  const segments = useSelectedLayoutSegments();
  const t = useTranslations();
  const direct =
    segments[0] === "direct";
  const semanticChat =
    segments[0] === "chat";
  const identity =
    segments[0] === "people" ||
    segments[0] === "profile";
  const detailLabel =
    segments[0] === "people"
      ? t("profile.people")
      : segments[0] === "profile"
        ? t("profile.title")
        : t("chat.detailPane");
  return (
    <MasterDetailLayout
      detailOpen={segments.length > 0}
      masterLabel={t("chat.listPane")}
      detailLabel={detailLabel}
      master={
        <ConversationListPane
          aiId={
            direct || semanticChat || identity
              ? undefined
              : segments[0]
          }
          directId={
            direct
              ? segments[1]
              : undefined
          }
        />
      }
      masterFooter={<DesktopSectionDock />}
    >
      {children}
    </MasterDetailLayout>
  );
}
