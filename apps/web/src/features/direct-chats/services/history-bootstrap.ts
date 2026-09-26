export const DEEP_HISTORY_BOOTSTRAP_MAX_PAGES = 8;

export function shouldContinueDeepHistoryBootstrap(input: {
  cursor: string | null;
  missingSenderCount: number;
  backfillPages: number;
}): boolean {
  return (
    input.cursor !== null &&
    input.missingSenderCount > 0 &&
    input.backfillPages <
      DEEP_HISTORY_BOOTSTRAP_MAX_PAGES
  );
}
