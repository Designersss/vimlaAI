import { describe, expect, it } from "vitest";
import { formatReminderInstant } from "./format-time.js";
import { sanitizeHrefPath } from "./destinations.js";
import { sanitizeUserText } from "./text.js";
import { renderEmailTemplate } from "../templates.js";

describe("timezone presentation", () => {
  it("formats the same UTC instant in Moscow and a DST-capable zone", () => {
    const instant = new Date("2026-03-29T10:00:00.000Z");
    const moscow = formatReminderInstant({ instant, timeZone: "Europe/Moscow", locale: "en" });
    const amsterdam = formatReminderInstant({ instant, timeZone: "Europe/Amsterdam", locale: "en" });
    expect(moscow).not.toBe(amsterdam);
    expect(amsterdam).toContain("2026");
  });
});

describe("safe presentation", () => {
  it("strips control characters from reminder titles", () => {
    expect(sanitizeUserText("Call\nme\u0000now", 200)).toBe("Call me now");
  });

  it("allows only known internal hrefs", () => {
    expect(sanitizeHrefPath("/work/reminders")).toBe("/work/reminders");
    expect(sanitizeHrefPath("https://evil.example")).toBeNull();
    expect(sanitizeHrefPath("/app")).toBeNull();
  });

  it("renders reminder email as text without HTML", () => {
    const rendered = renderEmailTemplate("reminderDue", "ru", {
      reminderTitle: "<script>alert(1)</script>",
      scheduledLabel: "10 сент. 2026 г., 15:00",
      openUrl: "https://app.vimla.example/work/reminders",
    });
    expect(rendered.text).toContain("<script>alert(1)</script>");
    expect(rendered.text).not.toMatch(/<html|<a /i);
    expect(rendered.subject).toBe("Напоминание Vimla");
  });
});
