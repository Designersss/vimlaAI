export const REMINDER_OCCURRENCE_PREFIX = "reminder";

const ISO_INSTANT = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;

export function reminderOccurrenceKey(reminderId: string, scheduledAt: Date): string {
  return `${REMINDER_OCCURRENCE_PREFIX}:${reminderId}:${scheduledAt.toISOString()}`;
}

export function scheduledInstantFromOccurrenceKey(occurrenceKey: string): Date | null {
  const prefix = `${REMINDER_OCCURRENCE_PREFIX}:`;
  if (!occurrenceKey.startsWith(prefix)) {
    return null;
  }
  const match = ISO_INSTANT.exec(occurrenceKey);
  if (!match?.[1] || !occurrenceKey.endsWith(`:${match[1]}`)) {
    return null;
  }
  const parsed = new Date(match[1]);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== match[1]) {
    return null;
  }
  return parsed;
}
