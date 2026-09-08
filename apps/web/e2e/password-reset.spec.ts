import { expect, test } from "@playwright/test";
import { formAlert, latestDelivery, signInEmail, signUp, uniqueEmail, verifyEmail, webOrigin } from "./helpers";

test.describe("password reset", () => {
  test("resets password, rejects the old password and replays", async ({ page, request }) => {
    const email = uniqueEmail("e2e-reset");
    const oldPassword = "correct-horse-battery";
    const newPassword = "new-horse-battery-1";
    await signUp(page, { name: "Ada", email, password: oldPassword });
    await verifyEmail(page, request, email);
    await page.getByRole("button", { name: /выйти|sign out/i }).click();

    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /отправить инструкции|send instructions/i }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const delivery = await latestDelivery(request, "email", email, { requireResetUrl: true });
    expect(delivery.resetUrl).toBeTruthy();
    const resetUrl = new URL(delivery.resetUrl ?? "");
    expect(resetUrl.origin).toBe(webOrigin);

    await page.goto(resetUrl.pathname + resetUrl.search);
    await page.locator("#reset-password").fill(newPassword);
    await page.locator("#reset-confirm").fill(newPassword);
    await page.getByRole("button", { name: /сохранить пароль|save password/i }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.waitForURL(/sign-in/, { timeout: 10_000 });

    await signInEmail(page, email, oldPassword);
    await expect(formAlert(page)).toContainText(/неверный email или пароль|invalid email or password/i);

    await signInEmail(page, email, newPassword);
    await expect(page).toHaveURL(/\/app/);

    await page.goto(resetUrl.pathname + resetUrl.search);
    await page.locator("#reset-password").fill("another-horse-battery");
    await page.locator("#reset-confirm").fill("another-horse-battery");
    await page.getByRole("button", { name: /сохранить пароль|save password/i }).click();
    await expect(formAlert(page)).toBeVisible();
  });
});
