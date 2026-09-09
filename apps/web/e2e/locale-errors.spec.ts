import { expect, test } from "@playwright/test";
import {
  confirmCodeButton,
  fillOtp,
  formAlert,
  purchasePro,
  seedLocale,
  signInEmail,
  signUp,
  switchLocale,
  uniqueEmail,
  verifyEmail,
} from "./helpers";

test.describe("locale and errors", () => {
  test("keeps EN after refresh and login", async ({ page, request }) => {
    const email = uniqueEmail("e2e-locale");
    const password = "correct-horse-battery";
    await signUp(page, { name: "Ada", email, password });
    await verifyEmail(page, request, email);
    await switchLocale(page, "en");
    await expect(page.getByRole("button", { name: /new chat/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /new chat/i })).toBeVisible();
    await page.getByRole("button", { name: /sign out/i }).click();
    await signInEmail(page, email, password);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("button", { name: /new chat/i })).toBeVisible();
  });

  test("shows localized Vimla errors for credentials, verification, OTP, rate limit and AI", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await seedLocale(page, "ru");
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill("missing@example.com");
    await page.locator("#auth-password").fill("wrong-password-1");
    await page.getByRole("button", { name: /войти|sign in/i }).click();
    await expect(formAlert(page)).toContainText(/неверный email или пароль|invalid email or password/i);

    const email = uniqueEmail("e2e-errors");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await page.goto("/app");
    await expect(page).toHaveURL(/verify-email/);

    await fillOtp(page, "000000");
    await confirmCodeButton(page).click();
    await expect(formAlert(page)).toContainText(/неверный код|invalid code/i);

    await verifyEmail(page, request, email);
    await page.goto("/app");
    await page.getByRole("button", { name: /новый чат|new chat/i }).click();
    await page.getByPlaceholder(/сообщение для vimla|message vimla/i).fill("Need usage");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.locator("p").filter({ hasText: /недостаточно|not enough|usage/i }).first()).toBeVisible();

    await purchasePro(page);
    await page.goto("/app");
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    await expect(composer).toBeVisible();
    await composer.fill("Hello 0");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText("Hello from Vimla")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/сообщение для vimla|message vimla/i).fill("Hello 1");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText("Hello from Vimla").nth(1)).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/сообщение для vimla|message vimla/i).fill("Hello 2");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText(/слишком много|too many/i).first()).toBeVisible();
  });
});
