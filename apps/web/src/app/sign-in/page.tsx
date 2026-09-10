"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Text } from "@vimla/ui";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default function SignInPage(): ReactElement {
  const t = useTranslations();

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title={t("auth.signIn")}
      panelTitle={t("auth.panelTitle")}
      panelBody={t("auth.panelBody")}
      footer={
        <>
          <Text>
            <Link href="/forgot-password">{t("auth.forgotPassword")}</Link>
          </Text>
          <Text>
            {t("auth.noAccount")} <Link href="/sign-up">{t("auth.createOne")}</Link>
          </Text>
        </>
      }
    >
      <AuthForm mode="sign-in" />
    </AuthPageFrame>
  );
}
