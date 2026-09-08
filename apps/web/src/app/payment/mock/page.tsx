import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import styles from "../../page.module.scss";

function MockPayInner({
  paymentId,
  returnLabel,
  copy,
}: {
  paymentId: string | undefined;
  returnLabel: string;
  copy: string;
}): ReactElement {
  const href = paymentId
    ? `/payment/result?paymentId=${encodeURIComponent(paymentId)}`
    : "/settings/billing";
  return (
    <section>
      <p>{copy}</p>
      <p>
        <Link href={href}>{returnLabel}</Link>
      </p>
    </section>
  );
}

export default async function MockPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string }>;
}): Promise<ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>{t("billing.mockTitle")}</h1>
      <Suspense>
        <MockPayInner
          paymentId={params.paymentId}
          copy={t("billing.mockCopy")}
          returnLabel={t("billing.returnToMerchant")}
        />
      </Suspense>
    </main>
  );
}
