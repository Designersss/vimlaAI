import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { isUiCatalogEnabled } from "../../../shared/config/ui-catalog";
import { UiCatalog } from "./UiCatalog";
import styles from "./catalog.module.scss";

export default function DevUiPage(): ReactElement {
  if (!isUiCatalogEnabled()) {
    notFound();
  }
  return (
    <div className={styles.page}>
      <UiCatalog />
    </div>
  );
}
