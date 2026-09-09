import type { ReactElement, ReactNode } from "react";
import { AuthCard, AuthLayout, Heading, Text } from "@vimla/ui";
import { LanguageSwitcher } from "../../../../shared/i18n/LanguageSwitcher";

export function AuthPageFrame({
  eyebrow,
  title,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  return (
    <AuthLayout>
      <AuthCard>
        <LanguageSwitcher />
        <Text tone="caption">{eyebrow}</Text>
        <Heading as="h1" size="page">
          {title}
        </Heading>
        {children}
        {footer}
      </AuthCard>
    </AuthLayout>
  );
}
