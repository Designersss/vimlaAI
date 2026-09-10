import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { VerifyEmailForm } from "../../features/auth/components/VerifyEmailForm/VerifyEmailForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default async function VerifyEmailPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title={t("auth.verifyEmail.title")}
      panelTitle={t("auth.panelTitle")}
      panelBody={t("auth.panelVerify")}
    >
      <VerifyEmailForm />
    </AuthPageFrame>
  );
}
