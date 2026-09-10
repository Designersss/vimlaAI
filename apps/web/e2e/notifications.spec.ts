import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("notification platform", () => {
  test("persists notification settings across reload", async ({ page, request }) => {
    const email = uniqueEmail("e2e-notify-settings");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: /уведомления|notifications/i }).first()).toBeVisible();
    const inApp = page.getByRole("switch", { name: /в приложении|in the app/i });
    const byEmail = page.getByRole("switch", { name: /по email|by email/i });
    await expect(inApp).toBeVisible();
    await expect(byEmail).toBeVisible();
    await expect(inApp).toBeChecked();
    await expect(byEmail).not.toBeChecked();
    await byEmail.click();
    await expect(page.getByText(/сохранены|saved/i)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: /по email|by email/i })).toBeChecked();
  });

  test("shows a real reminder notification and mark-read actions", async ({ page, request }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-notify-center");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);

    await page.goto("/work");
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    await page.getByTestId("notification-bell").click();
    await expect(page.getByRole("dialog", { name: /уведомления|notifications/i })).toBeVisible();
    await expect(page.getByText(/уведомлений пока нет|no notifications yet/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: /напоминания|reminders/i }).first().click();
    await page.getByLabel(/название|title/i).fill("E2E reminder ping");
    const due = toDatetimeLocal(new Date(Date.now() - 60_000));
    await page.locator("#reminder-at").fill(due);
    const tzConfirm = page.getByRole("checkbox", { name: /использовать|use /i });
    if (await tzConfirm.count()) {
      await tzConfirm.check();
    }
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page.getByText("E2E reminder ping")).toBeVisible();

    await expect(page.getByTestId("notification-unread-dot")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("notification-bell").click();
    const item = page.getByRole("button", { name: /E2E reminder ping/i });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByTestId("notification-unread-dot")).toHaveCount(0);

    await page.getByTestId("notification-bell").click();
    await page.getByRole("button", { name: /отметить все|mark all as read/i }).click();
    await page.keyboard.press("Escape");
  });

  test("notification center fits mobile and desktop", async ({ page, request }) => {
    const email = uniqueEmail("e2e-notify-responsive");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/work");
      const bell = page.getByTestId("notification-bell");
      await expect(bell).toBeVisible();
      await assertReachable(page, bell);
      await bell.click();
      await expect(page.getByRole("dialog", { name: /уведомления|notifications/i })).toBeVisible();
      await assertNoDocumentOverflow(page);
      await page.keyboard.press("Escape");
    }
  });
});

function toDatetimeLocal(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
