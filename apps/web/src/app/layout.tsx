import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import {
  AppearanceProvider,
  ThemeScript,
  ToastProvider,
  parseAppearance,
} from "@vimla/ui";
import "@vimla/ui/styles";
import styles from "./layout.module.scss";

export const metadata: Metadata = {
  title: "Vimla",
  description: "Unified AI workspace",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactNode> {
  const locale = await getLocale();
  const messages = await getMessages();
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const appearance = parseAppearance(
    cookieStore.get("vimla_appearance")?.value,
  );
  const nonce =
    requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html lang={locale} data-appearance={appearance} data-density="comfortable" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className={styles.body}>
        <AppearanceProvider initialAppearance={appearance} density="comfortable">
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
