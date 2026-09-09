import { isIanaTimeZone } from "@vimla/contracts";
import { WorkspaceError } from "./errors.js";

export function assertIanaTimeZone(value: string): string {
  if (!isIanaTimeZone(value)) {
    throw new WorkspaceError("INVALID_TIMEZONE", "Invalid timezone");
  }
  return value;
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).flatMap((part) =>
      part.type === "literal" ? [] : [[part.type, part.value] as const],
    ),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  assertIanaTimeZone(timeZone);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - tzOffsetMs(first, timeZone));
}

export function calendarDateInZone(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  assertIanaTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).flatMap((part) =>
      part.type === "literal" ? [] : [[part.type, part.value] as const],
    ),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

export function zonedDayBounds(instant: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month, day } = calendarDateInZone(instant, timeZone);
  const start = zonedLocalToUtc(year, month, day, 0, 0, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
  return { start, end };
}

export function addCalendarDays(year: number, month: number, day: number, delta: number): {
  year: number;
  month: number;
  day: number;
} {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}
