import type { ReactElement } from "react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Heading, Text, buttonClassName } from "@vimla/ui";
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
      <Text>{copy}</Text>
      <p>
        <Link href={href} className={buttonClassName({ variant: "primary" })}>
          {returnLabel}
        </Link>
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
      <Heading as="h1" size="page">
        {t("billing.mockTitle")}
      </Heading>
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
