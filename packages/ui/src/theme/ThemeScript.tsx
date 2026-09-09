import type { ReactElement } from "react";
import { APPEARANCE_BOOTSTRAP_SCRIPT } from "./appearance";

export function ThemeScript(): ReactElement {
  return <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP_SCRIPT }} />;
}
