import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../shared/styles/tokens.scss";
import styles from "./layout.module.scss";

export const metadata: Metadata = {
  title: "Vimla",
  description: "Unified AI workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="en">
      <body className={styles.body}>{children}</body>
    </html>
  );
}
