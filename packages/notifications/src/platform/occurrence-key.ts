export const REMINDER_OCCURRENCE_PREFIX = "reminder";

export function reminderOccurrenceKey(reminderId: string, scheduledAt: Date): string {
  return `${REMINDER_OCCURRENCE_PREFIX}:${reminderId}:${scheduledAt.toISOString()}`;
}

export function scheduledInstantFromOccurrenceKey(occurrenceKey: string): Date | null {
  const prefix = `${REMINDER_OCCURRENCE_PREFIX}:`;
  if (!occurrenceKey.startsWith(prefix)) {
    return null;
  }
  const lastColon = occurrenceKey.lastIndexOf(":");
  if (lastColon <= prefix.length - 1) {
    return null;
  }
  const instant = occurrenceKey.slice(lastColon + 1);
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant) {
    return null;
  }
  return parsed;
}
