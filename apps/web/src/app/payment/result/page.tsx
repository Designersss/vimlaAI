import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PaymentResult } from "./PaymentResult";
import styles from "../../page.module.scss";

export default async function PaymentResultPage(): Promise<ReactElement> {
  const t = await getTranslations();
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>{t("billing.resultTitle")}</h1>
      <Suspense fallback={<p>{t("common.loading")}</p>}>
        <PaymentResult />
      </Suspense>
    </main>
  );
}
