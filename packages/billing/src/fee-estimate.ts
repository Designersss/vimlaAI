import { applyBpsCeil, type MicroRub } from "./money.js";

export interface AcquiringFeePolicy {
  feeBps: bigint;
  feeVatBps: bigint;
  minimumFeeMicroRub: MicroRub | null;
  fixedFeeMicroRub: MicroRub | null;
}

export interface FiscalizationFeePolicy {
  percentageBps: bigint | null;
  fixedFeeMicroRub: MicroRub | null;
}

export interface EstimatedAcquiringFee {
  feeMicroRub: MicroRub;
  vatMicroRub: MicroRub;
}

export function estimateAcquiringFee(
  grossMicroRub: MicroRub,
  policy: AcquiringFeePolicy,
): EstimatedAcquiringFee {
  let fee = applyBpsCeil(grossMicroRub, policy.feeBps);
  if (policy.fixedFeeMicroRub !== null) {
    fee += policy.fixedFeeMicroRub;
  }
  if (policy.minimumFeeMicroRub !== null && fee < policy.minimumFeeMicroRub) {
    fee = policy.minimumFeeMicroRub;
  }
  const vat = applyBpsCeil(fee, policy.feeVatBps);
  return { feeMicroRub: fee, vatMicroRub: vat };
}

export function estimateFiscalizationFee(
  grossMicroRub: MicroRub,
  policy: FiscalizationFeePolicy,
): MicroRub {
  let fee = 0n;
  if (policy.percentageBps !== null) {
    fee += applyBpsCeil(grossMicroRub, policy.percentageBps);
  }
  if (policy.fixedFeeMicroRub !== null) {
    fee += policy.fixedFeeMicroRub;
  }
  return fee;
}

export function estimateTaxReserve(netSalesMicroRub: MicroRub, reserveBps: bigint): MicroRub {
  return applyBpsCeil(netSalesMicroRub, reserveBps);
}

/** Prefer actual when present; never add actual + estimated. */
export function chooseFee(actual: MicroRub | null, estimated: MicroRub | null): {
  amount: MicroRub;
  quality: "ACTUAL" | "ESTIMATED" | "UNKNOWN";
} {
  if (actual !== null) {
    return { amount: actual, quality: "ACTUAL" };
  }
  if (estimated !== null) {
    return { amount: estimated, quality: "ESTIMATED" };
  }
  return { amount: 0n, quality: "UNKNOWN" };
}

export function mergeQuality(
  qualities: ReadonlyArray<"ACTUAL" | "ESTIMATED" | "PARTIAL" | "UNKNOWN">,
): "ACTUAL" | "ESTIMATED" | "PARTIAL" | "UNKNOWN" {
  const unique = new Set(qualities);
  if (unique.size === 0 || (unique.size === 1 && unique.has("UNKNOWN"))) {
    return "UNKNOWN";
  }
  if (unique.has("PARTIAL")) {
    return "PARTIAL";
  }
  if (unique.has("UNKNOWN") && unique.size > 1) {
    return "PARTIAL";
  }
  if (unique.has("ACTUAL") && unique.has("ESTIMATED")) {
    return "PARTIAL";
  }
  if (unique.has("ACTUAL")) {
    return "ACTUAL";
  }
  return "ESTIMATED";
}
