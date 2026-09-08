import type { Prisma } from "@vimla/database";
import { estimateAcquiringFee, estimateFiscalizationFee } from "./fee-estimate.js";
import type { PaymentMethod } from "./payment-method.js";

type Tx = Prisma.TransactionClient;

export async function ensurePaymentEconomics(
  tx: Tx,
  input: {
    paymentId: string;
    grossAmountMicroRub: bigint;
    provider: string;
    occurredAt: Date;
    paymentMethod: PaymentMethod | null;
    rawProviderPaymentMethod: string | null;
  },
): Promise<{ status: string; created: boolean }> {
  const existing = await tx.paymentEconomics.findUnique({
    where: { paymentId: input.paymentId },
  });
  if (existing) {
    return { status: existing.economicsStatus, created: false };
  }

  const method = input.paymentMethod && input.paymentMethod !== "UNKNOWN" ? input.paymentMethod : null;
  const feePolicy = method
    ? await findPublishedFeePolicy(tx, input.provider, method, input.occurredAt)
    : null;
  const fiscalPolicy = await findPublishedFiscalPolicy(tx, input.provider, input.occurredAt);

  let estimatedAcquiringFeeMicroRub: bigint | null = null;
  let estimatedAcquiringFeeVatMicroRub: bigint | null = null;
  let estimatedFiscalizationFeeMicroRub: bigint | null = null;
  let economicsStatus = "ESTIMATED";

  if (!method) {
    economicsStatus = "RECONCILIATION_REQUIRED";
  } else if (!feePolicy) {
    economicsStatus = "RECONCILIATION_REQUIRED";
  } else {
    const acquiring = estimateAcquiringFee(input.grossAmountMicroRub, {
      feeBps: BigInt(feePolicy.feeBps),
      feeVatBps: BigInt(feePolicy.feeVatBps),
      minimumFeeMicroRub: feePolicy.minimumFeeMicroRub,
      fixedFeeMicroRub: feePolicy.fixedFeeMicroRub,
    });
    estimatedAcquiringFeeMicroRub = acquiring.feeMicroRub;
    estimatedAcquiringFeeVatMicroRub = acquiring.vatMicroRub;
    if (feePolicy.sourceQuality !== "VERIFIED") {
      economicsStatus = "ESTIMATED";
    }
  }

  if (fiscalPolicy) {
    estimatedFiscalizationFeeMicroRub = estimateFiscalizationFee(input.grossAmountMicroRub, {
      percentageBps: fiscalPolicy.percentageBps === null ? null : BigInt(fiscalPolicy.percentageBps),
      fixedFeeMicroRub: fiscalPolicy.fixedFeeMicroRub,
    });
  }

  await tx.paymentEconomics.create({
    data: {
      paymentId: input.paymentId,
      grossAmountMicroRub: input.grossAmountMicroRub,
      paymentMethod: method ?? "UNKNOWN",
      paymentFeePolicyVersionId: feePolicy?.id ?? null,
      estimatedAcquiringFeeMicroRub,
      estimatedAcquiringFeeVatMicroRub,
      fiscalizationFeePolicyVersionId: fiscalPolicy?.id ?? null,
      estimatedFiscalizationFeeMicroRub,
      economicsStatus,
    },
  });

  return { status: economicsStatus, created: true };
}

export async function addRefundToEconomics(
  tx: Tx,
  paymentId: string,
  refundedAmountMicroRub: bigint,
): Promise<void> {
  const existing = await tx.paymentEconomics.findUnique({ where: { paymentId } });
  if (!existing) {
    return;
  }
  const next = existing.refundedAmountMicroRub + refundedAmountMicroRub;
  const status =
    next > existing.grossAmountMicroRub || refundedAmountMicroRub <= 0n
      ? "RECONCILIATION_REQUIRED"
      : existing.economicsStatus === "ACTUAL"
        ? "PARTIAL"
        : existing.economicsStatus;
  await tx.paymentEconomics.update({
    where: { paymentId },
    data: {
      refundedAmountMicroRub: next,
      economicsStatus: status,
    },
  });
}

export async function addChargebackToEconomics(
  tx: Tx,
  paymentId: string,
  amountMicroRub: bigint,
): Promise<void> {
  const existing = await tx.paymentEconomics.findUnique({ where: { paymentId } });
  if (!existing) {
    return;
  }
  await tx.paymentEconomics.update({
    where: { paymentId },
    data: {
      chargebackAmountMicroRub: existing.chargebackAmountMicroRub + amountMicroRub,
      economicsStatus: "RECONCILIATION_REQUIRED",
    },
  });
}

async function findPublishedFeePolicy(
  tx: Tx,
  provider: string,
  paymentMethod: string,
  at: Date,
) {
  return tx.paymentFeePolicyVersion.findFirst({
    where: {
      provider,
      paymentMethod,
      status: "PUBLISHED",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findPublishedFiscalPolicy(tx: Tx, provider: string, at: Date) {
  return tx.fiscalizationFeePolicyVersion.findFirst({
    where: {
      provider,
      status: "PUBLISHED",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}
