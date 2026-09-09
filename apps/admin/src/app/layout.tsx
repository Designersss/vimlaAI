import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppearanceProvider, ThemeScript, ToastProvider, parseAppearance } from "@vimla/ui";
import "@vimla/ui/styles";
import styles from "./layout.module.scss";

export const metadata: Metadata = {
  title: "Vimla Admin",
  description: "Vimla finance and tariff control plane",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactNode> {
  const locale = await getLocale();
  const messages = await getMessages();
  const cookieStore = await cookies();
  const appearance = parseAppearance(cookieStore.get("vimla_appearance")?.value);

  return (
    <html lang={locale} data-appearance={appearance} data-density="compact" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={styles.body}>
        <AppearanceProvider initialAppearance={appearance} density="compact">
          <ToastProvider>
            <NextIntlClientProvider locale={locale} messages={messages}>
              {children}
            </NextIntlClientProvider>
          </ToastProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
