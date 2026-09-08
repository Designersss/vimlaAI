import { marginBpsFloor, type MicroRub } from "./money.js";
import {
  estimateAcquiringFee,
  estimateFiscalizationFee,
  estimateTaxReserve,
  type AcquiringFeePolicy,
  type FiscalizationFeePolicy,
} from "./fee-estimate.js";
import type { PaymentMethod } from "./payment-method.js";

export type GuardrailAssessment = "SAFE" | "WARNING" | "NEGATIVE";

export interface TariffSimulationAssumptions {
  priceMicroRub: MicroRub;
  monthlyUsageGrantMicroRub: MicroRub;
  paymentFees: Partial<Record<Exclude<PaymentMethod, "UNKNOWN">, AcquiringFeePolicy>>;
  fiscalization?: FiscalizationFeePolicy;
  taxReserveBps?: bigint;
  otherVariableCostMicroRub?: MicroRub;
  targetMinimumMarginBps?: number;
}

export interface PaymentMethodSimulation {
  paymentMethod: Exclude<PaymentMethod, "UNKNOWN">;
  paymentCostMicroRub: MicroRub;
  fiscalizationCostMicroRub: MicroRub;
  taxReserveMicroRub: MicroRub | null;
  maxAiCommitmentMicroRub: MicroRub;
  conservativeContributionMicroRub: MicroRub;
  conservativeMarginBps: number | null;
  guardrail: GuardrailAssessment;
}

export interface TariffSimulationResult {
  methods: PaymentMethodSimulation[];
  worstCase: PaymentMethodSimulation | null;
}

export function simulateTariffEconomics(input: TariffSimulationAssumptions): TariffSimulationResult {
  const methods: PaymentMethodSimulation[] = [];
  for (const paymentMethod of ["CARD", "SBP", "T_PAY", "OTHER"] as const) {
    const feePolicy = input.paymentFees[paymentMethod];
    if (!feePolicy) {
      continue;
    }
    methods.push(simulateOne(paymentMethod, feePolicy, input));
  }
  const worstCase =
    methods.length === 0
      ? null
      : methods.reduce((worst, current) =>
          current.conservativeContributionMicroRub < worst.conservativeContributionMicroRub
            ? current
            : worst,
        );
  return { methods, worstCase };
}

function simulateOne(
  paymentMethod: Exclude<PaymentMethod, "UNKNOWN">,
  feePolicy: AcquiringFeePolicy,
  input: TariffSimulationAssumptions,
): PaymentMethodSimulation {
  const acquiring = estimateAcquiringFee(input.priceMicroRub, feePolicy);
  const paymentCostMicroRub = acquiring.feeMicroRub + acquiring.vatMicroRub;
  const fiscalizationCostMicroRub = input.fiscalization
    ? estimateFiscalizationFee(input.priceMicroRub, input.fiscalization)
    : 0n;
  const netAfterFees = input.priceMicroRub - paymentCostMicroRub - fiscalizationCostMicroRub;
  const taxReserveMicroRub =
    input.taxReserveBps === undefined ? null : estimateTaxReserve(netAfterFees < 0n ? 0n : netAfterFees, input.taxReserveBps);
  const other = input.otherVariableCostMicroRub ?? 0n;
  const tax = taxReserveMicroRub ?? 0n;
  const conservativeContributionMicroRub =
    input.priceMicroRub -
    paymentCostMicroRub -
    fiscalizationCostMicroRub -
    tax -
    other -
    input.monthlyUsageGrantMicroRub;
  const conservativeMarginBps = marginBpsFloor(conservativeContributionMicroRub, input.priceMicroRub);
  return {
    paymentMethod,
    paymentCostMicroRub,
    fiscalizationCostMicroRub,
    taxReserveMicroRub,
    maxAiCommitmentMicroRub: input.monthlyUsageGrantMicroRub,
    conservativeContributionMicroRub,
    conservativeMarginBps,
    guardrail: assessGuardrail(conservativeMarginBps, input.targetMinimumMarginBps ?? 0),
  };
}

export function assessGuardrail(
  marginBps: number | null,
  targetMinimumMarginBps: number,
): GuardrailAssessment {
  if (marginBps === null || marginBps < 0) {
    return "NEGATIVE";
  }
  if (marginBps < targetMinimumMarginBps) {
    return "WARNING";
  }
  return "SAFE";
}
