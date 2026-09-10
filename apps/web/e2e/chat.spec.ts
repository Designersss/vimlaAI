import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, startNewConversation } from "./helpers";

test.describe("AI verification gate", () => {
  test("unverified users are sent to verify-email instead of chat", async ({ page }) => {
    await signUp(page, {
      name: "Ada",
      email: uniqueEmail("e2e-unverified"),
      password: "correct-horse-battery",
    });
    await page.goto("/app");
    await expect(page).toHaveURL(/verify-email/);
    await expect(page.getByRole("heading", { name: /подтвердите email|verify/i })).toBeVisible();
  });

  test("verified users with usage stream a mock assistant reply", async ({ page, request }) => {
    const email = uniqueEmail("e2e-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await startNewConversation(page);
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    await expect(composer).toBeVisible();
    await composer.fill("Hello");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText("Hello from Vimla")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^pro ·|^про ·/i }).click();
    await expect(page.getByRole("menuitem", { name: /^pro$|^про$/i })).toBeVisible();
    await expect(page.getByText(/auto routing is not available|auto-маршрутизация пока недоступна/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /◆ @vimla/i })).toBeVisible();
    await page.getByRole("button", { name: /◆ @vimla/i }).click();
    await expect(page.getByText("◆ @Vimla").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^pro ·|^про ·/i })).toHaveCount(0);
  });
});
