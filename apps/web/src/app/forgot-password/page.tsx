import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Text } from "@vimla/ui";
import { ForgotPasswordForm } from "../../features/auth/components/ForgotPasswordForm/ForgotPasswordForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default async function ForgotPasswordPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title={t("auth.forgot.title")}
      panelTitle={t("auth.panelTitle")}
      panelBody={t("auth.panelForgot")}
      footer={
        <Text>
          <Link href="/sign-in">{t("auth.signIn")}</Link>
        </Text>
      }
    >
      <ForgotPasswordForm />
    </AuthPageFrame>
  );
}
