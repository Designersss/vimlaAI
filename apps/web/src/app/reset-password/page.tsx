import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Spinner } from "@vimla/ui";
import { ResetPasswordForm } from "../../features/auth/components/ResetPasswordForm/ResetPasswordForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";

export default async function ResetPasswordPage(): Promise<ReactElement> {
  const t = await getTranslations();

  return (
    <AuthPageFrame eyebrow={t("home.eyebrow")} title={t("auth.reset.title")}>
      <Suspense fallback={<Spinner label={t("common.loading")} />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthPageFrame>
  );
}
