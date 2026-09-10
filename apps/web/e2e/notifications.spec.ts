import { expect, test } from "@playwright/test";
import { createDueReminder, signUp, uniqueEmail, verifyEmail } from "./helpers";
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

    await createDueReminder(page, "E2E reminder ping");

    const item = page.getByTestId("notification-item").filter({ hasText: "E2E reminder ping" });
    await expect(async () => {
      await page.keyboard.press("Escape");
      await page.getByTestId("notification-bell").click();
      await expect(item).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByTestId("notification-unread-dot")).toBeVisible();
    await page.getByRole("button", { name: /отметить все|mark all as read/i }).click();
    await expect(page.getByTestId("notification-unread-dot")).toHaveCount(0);
    await item.click();
    await expect(page).toHaveURL(/\/work\/reminders/);
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
