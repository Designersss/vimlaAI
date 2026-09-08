export function formatMoney(micro: string | null | undefined): string {
  if (micro === null || micro === undefined) {
    return "—";
  }
  const rub = Number(BigInt(micro) / 1_000_000n);
  return `${rub.toLocaleString("ru-RU")} ₽`;
}

export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) {
    return "—";
  }
  return `${(bps / 100).toFixed(1)}%`;
}

export function zonedMidnightUtc(timeZone: string, date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const localRead = (type: Intl.DateTimeFormatPartTypes) =>
      Number(local.find((part) => part.type === type)?.value);
    const localAsUtc = Date.UTC(
      localRead("year"),
      localRead("month") - 1,
      localRead("day"),
      localRead("hour"),
      localRead("minute"),
      localRead("second"),
    );
    utc += Date.UTC(year, month - 1, day, 0, 0, 0) - localAsUtc;
  }
  return new Date(utc);
}

export function presetRange(
  timeZone: string,
  preset: "today" | "7" | "30",
): { from: string; to: string } {
  const now = new Date();
  const todayStart = zonedMidnightUtc(timeZone, now);
  if (preset === "today") {
    return { from: todayStart.toISOString(), to: now.toISOString() };
  }
  const days = preset === "7" ? 6 : 29;
  const from = new Date(todayStart.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}
