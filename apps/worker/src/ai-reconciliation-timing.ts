export function aiReconciliationCutoffs(input: {
  now: Date;
  preProviderStaleMs: number;
  providerStaleMs: number;
}) {
  return {
    preProvider: new Date(input.now.getTime() - input.preProviderStaleMs),
    provider: new Date(input.now.getTime() - input.providerStaleMs),
  };
}
