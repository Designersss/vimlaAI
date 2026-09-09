import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Heading, Spinner } from "@vimla/ui";
import { PaymentResult } from "./PaymentResult";
import styles from "../../page.module.scss";

export default async function PaymentResultPage(): Promise<ReactElement> {
  const t = await getTranslations();
  return (
    <main className={styles.main}>
      <Heading as="h1" size="page">
        {t("billing.resultTitle")}
      </Heading>
      <Suspense fallback={<Spinner label={t("common.loading")} />}>
        <PaymentResult />
      </Suspense>
    </main>
  );
}
