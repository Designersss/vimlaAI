export const AI_RECONCILIATION_PRE_PROVIDER_STALE_MS = 5 * 60_000;
export const AI_RECONCILIATION_PROVIDER_GRACE_MS = 60_000;

export function aiReconciliationCutoffs(now: Date, providerTimeoutMs: number) {
  return {
    preProvider: new Date(now.getTime() - AI_RECONCILIATION_PRE_PROVIDER_STALE_MS),
    provider: new Date(
      now.getTime() - providerTimeoutMs - AI_RECONCILIATION_PROVIDER_GRACE_MS,
    ),
  };
}
