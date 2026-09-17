import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { ClaimHandleForm } from "../../features/auth/components/ClaimHandleForm/ClaimHandleForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default async function ClaimHandlePage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title="@login"
      panelTitle={t("auth.panelTitle")}
      panelBody={t("auth.panelSignUp")}
    >
      <ClaimHandleForm />
    </AuthPageFrame>
  );
}
