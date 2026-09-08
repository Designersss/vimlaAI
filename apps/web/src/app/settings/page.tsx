import type { ReactElement } from "react";
import { redirect } from "next/navigation";

export default function SettingsIndexPage(): ReactElement {
  redirect("/settings/security");
}
