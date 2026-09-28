import type { ReactElement } from "react";
import { APPEARANCE_BOOTSTRAP_SCRIPT } from "./appearance";

export function ThemeScript({
  nonce,
}: {
  nonce?: string;
} = {}): ReactElement {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: APPEARANCE_BOOTSTRAP_SCRIPT,
      }}
    />
  );
}
