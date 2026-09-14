"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ConversationHeader, buttonClassName } from "@vimla/ui";
import styles from "./ChatWorkspace.module.scss";

export function ChatConversationHeader({ title, subtitle, trailing }: {
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}): ReactElement {
  const t = useTranslations();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <ConversationHeader
      back={
        <Link
          href="/app"
          scroll={false}
          aria-label={t("common.back")}
          className={`${buttonClassName({ variant: "ghost", size: "sm" })} ${styles.back}`}
        >
          <ChevronLeftIcon size={18} aria-hidden="true" />
        </Link>
      }
      title={
        <h2 ref={heading} tabIndex={-1} className={styles.conversationTitle}>{title}</h2>
      }
      subtitle={subtitle}
      trailing={trailing}
    />
  );
}
