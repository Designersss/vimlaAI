import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Text } from "@vimla/ui";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default async function SignUpPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title={t("auth.signUp")}
      footer={
        <Text>
          {t("auth.hasAccount")} <Link href="/sign-in">{t("auth.signIn")}</Link>
        </Text>
      }
    >
      <AuthForm mode="sign-up" />
    </AuthPageFrame>
  );
}
