import type { ReactElement, ReactNode } from "react";
import { AuthCard, AuthLayout, BrandLockup, Heading, Text } from "@vimla/ui";
import { LanguageSwitcher } from "../../../../shared/i18n/LanguageSwitcher";

export function AuthPageFrame({
  eyebrow,
  title,
  children,
  footer,
  panelTitle,
  panelBody,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  panelTitle?: string;
  panelBody?: string;
}): ReactElement {
  return (
    <AuthLayout
      panel={
        panelTitle ? (
          <>
            <Heading as="h2" size="section">
              {panelTitle}
            </Heading>
            {panelBody ? <Text tone="secondary">{panelBody}</Text> : null}
          </>
        ) : undefined
      }
    >
      <AuthCard>
        <LanguageSwitcher />
        <BrandLockup label={eyebrow} />
        <Heading as="h1" size="page">
          {title}
        </Heading>
        {children}
        {footer}
      </AuthCard>
    </AuthLayout>
  );
}
