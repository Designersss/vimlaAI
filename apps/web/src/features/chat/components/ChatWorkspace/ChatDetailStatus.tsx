"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Spinner } from "@vimla/ui";
import { ChatConversationHeader } from "./ChatConversationHeader";
import styles from "./ChatWorkspace.module.scss";

export function ChatDetailStatus({ failed = false, retry }: { failed?: boolean; retry?: () => void }): ReactElement {
  const t = useTranslations();
  return (
    <>
      <ChatConversationHeader title={t("chat.detailPane")} />
      <div className={styles.status}>
        {failed ? (
          <ErrorState title={t("chat.failed")} action={retry ? <Button onClick={retry}>{t("common.retry")}</Button> : undefined} />
        ) : <Spinner label={t("chat.loading")} />}
      </div>
    </>
  );
}
