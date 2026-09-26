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

export function pageUnlocksHistoryBootstrap(input: {
  missingSenderDeviceIds: ReadonlySet<string>;
  messages: ReadonlyArray<{
    senderDeviceId: string;
    envelope: {
      x3dhInit: unknown | null;
    } | null;
  }>;
}): boolean {
  return input.messages.some(
    (message) =>
      input.missingSenderDeviceIds.has(
        message.senderDeviceId,
      ) &&
      message.envelope?.x3dhInit != null,
  );
}
