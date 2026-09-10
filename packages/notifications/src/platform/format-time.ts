import type { VimlaLocale } from "@vimla/shared";

export function formatReminderInstant(input: {
  instant: Date;
  timeZone: string;
  locale: VimlaLocale;
}): string {
  return new Intl.DateTimeFormat(input.locale === "ru" ? "ru-RU" : "en-US", {
    timeZone: input.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(input.instant);
}
