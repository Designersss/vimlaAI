"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tab, Tabs, Text } from "@vimla/ui";
import { AuthForm } from "../../features/auth/components/AuthForm/AuthForm";
import { PhoneSignInForm } from "../../features/auth/components/PhoneSignInForm/PhoneSignInForm";
import { AuthPageFrame } from "../../features/auth/components/AuthPageFrame/AuthPageFrame";
import { useState } from "react";

export default function SignInPage(): ReactElement {
  const t = useTranslations();
  const [tab, setTab] = useState<"email" | "phone">("email");

  return (
    <AuthPageFrame
      eyebrow={t("home.eyebrow")}
      title={t("auth.signIn")}
      panelTitle={t("auth.panelTitle")}
      panelBody={t("auth.panelBody")}
      footer={
        <>
          {tab === "email" ? (
            <Text>
              <Link href="/forgot-password">{t("auth.forgotPassword")}</Link>
            </Text>
          ) : null}
          <Text>
            {t("auth.noAccount")} <Link href="/sign-up">{t("auth.createOne")}</Link>
          </Text>
        </>
      }
    >
      <Tabs label={t("auth.signIn")}>
        <Tab selected={tab === "email"} onSelect={() => setTab("email")}>
          {t("auth.emailTab")}
        </Tab>
        <Tab selected={tab === "phone"} onSelect={() => setTab("phone")}>
          {t("auth.phoneTab")}
        </Tab>
      </Tabs>
      {tab === "email" ? <AuthForm mode="sign-in" /> : <PhoneSignInForm />}
    </AuthPageFrame>
  );
}
