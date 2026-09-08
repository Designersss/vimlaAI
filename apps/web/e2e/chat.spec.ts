import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail } from "./helpers";

test.describe("AI verification gate", () => {
  test("unverified users are sent to verify-email instead of chat", async ({ page }) => {
    await signUp(page, {
      name: "Ada",
      email: uniqueEmail("e2e-unverified"),
      password: "correct-horse-battery",
    });
    await page.goto("/app");
    await expect(page).toHaveURL(/verify-email/);
    await expect(page.getByRole("heading")).toContainText(/подтвердите email|verify/i);
  });

  test("verified users with usage stream a mock assistant reply", async ({ page, request }) => {
    const email = uniqueEmail("e2e-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await page.goto("/app");
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    await expect(composer).toBeVisible();
    await composer.fill("Hello");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText("Hello from Vimla")).toBeVisible({ timeout: 20_000 });
  });
});
