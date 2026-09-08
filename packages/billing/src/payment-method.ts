export const PAYMENT_METHODS = ["CARD", "SBP", "T_PAY", "OTHER", "UNKNOWN"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const SOURCE_ALIASES: Record<string, PaymentMethod> = {
  cards: "CARD",
  card: "CARD",
  acq: "CARD",
  sbp: "SBP",
  qrsbp: "SBP",
  nspk: "SBP",
  tinkoffpay: "T_PAY",
  tpay: "T_PAY",
  "t-pay": "T_PAY",
  tinkoff_pay: "T_PAY",
};

/**
 * Normalize a T-Bank source using only signed/root fields or a trusted GetState Params.Source.
 * Nested unsigned webhook Params are not used by the webhook parser.
 */
export function normalizePaymentMethod(input: {
  signedPanPresent?: boolean;
  signedSource?: string | null;
  getStateSource?: string | null;
}): { paymentMethod: PaymentMethod; raw: string | null } {
  if (input.signedPanPresent) {
    return { paymentMethod: "CARD", raw: "pan" };
  }
  const raw = input.signedSource ?? input.getStateSource ?? null;
  if (!raw) {
    return { paymentMethod: "UNKNOWN", raw: null };
  }
  const normalized = raw.trim().toLowerCase();
  return {
    paymentMethod: SOURCE_ALIASES[normalized] ?? "OTHER",
    raw,
  };
}
