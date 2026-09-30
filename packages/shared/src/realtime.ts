export const REALTIME_USER_CHANNEL_PREFIX = "realtime:user:";

export function realtimeUserChannel(userId: string): string {
  if (userId.length === 0) {
    throw new Error("Realtime user id must not be empty");
  }
  return `${REALTIME_USER_CHANNEL_PREFIX}${userId}`;
}

export function realtimeUserIdFromChannel(
  channel: string,
): string | null {
  if (!channel.startsWith(REALTIME_USER_CHANNEL_PREFIX)) {
    return null;
  }
  const userId = channel.slice(
    REALTIME_USER_CHANNEL_PREFIX.length,
  );
  return userId.length > 0 ? userId : null;
}
