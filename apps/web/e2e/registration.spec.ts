import { expect, test } from "@playwright/test";
import {
  apiBase,
  confirmCodeButton,
  fillOtp,
  formAlert,
  latestDelivery,
  seedLocale,
  signUp,
  uniqueEmail,
  uniqueHandle,
  verifyEmail,
  webOrigin,
} from "./helpers";

test.describe("registration", () => {
  test("registers, verifies OTP and reaches the app in RU", async ({ page, request }) => {
    const email = uniqueEmail("e2e-ru");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" }, "ru");
    await expect(page.getByRole("heading", { name: /подтвердите email/i })).toBeVisible();
    await verifyEmail(page, request, email);
    await expect(page.getByRole("button", { name: /новый разговор/i })).toBeVisible();
  });

  test("registers a representative EN path", async ({ page, request }) => {
    const email = uniqueEmail("e2e-en");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" }, "en");
    await expect(page.getByRole("heading", { name: /verify/i })).toBeVisible();
    await verifyEmail(page, request, email);
    await expect(page.getByRole("button", { name: /new conversation/i })).toBeVisible();
  });

  test("shows a localized Vimla password error and does not create an account", async ({ page }) => {
    await seedLocale(page, "ru");
    await page.goto("/sign-up");
    await page.getByLabel(/имя|name/i).fill("Ada");
    await page.getByLabel(/email/i).fill(uniqueEmail("short-pass"));
    await page.locator("#auth-password").fill("123");
    await page.getByRole("button", { name: /создать аккаунт|create account/i }).click();
    await expect(page.getByText(/не менее 8 символов|at least 8 characters/i)).toBeVisible();
    await expect(page).toHaveURL(/sign-up/);
  });

  test("sends one signup request per submit and recovers from an existing email", async ({
    page,
    request,
  }) => {
    const existing = uniqueEmail("e2e-taken");
    const created = await request.post(`${apiBase}/api/auth/sign-up/email`, {
      data: {
        email: existing,
        password: "correct-horse-battery",
        name: "Ada",
      },
      headers: { origin: webOrigin, "content-type": "application/json" },
    });
    expect(created.status()).toBeGreaterThanOrEqual(200);
    expect(created.status()).toBeLessThan(300);

    await seedLocale(page, "ru");
    await page.goto("/sign-up");
    const signupPosts: string[] = [];
    page.on("request", (httpRequest) => {
      if (httpRequest.method() === "POST" && httpRequest.url().includes("/sign-up/email")) {
        signupPosts.push(httpRequest.url());
      }
    });

    await page.getByLabel(/имя|name/i).fill("Ada");
    await page.locator("#auth-handle").fill(uniqueHandle("retry"));
    await page.getByLabel(/email/i).fill(existing);
    await page.locator("#auth-password").fill("correct-horse-battery");
    await page.getByRole("button", { name: /создать аккаунт|create account/i }).click();
    await expect(formAlert(page)).toContainText(/не удалось завершить регистрацию|could not complete registration/i);
    await expect(page).toHaveURL(/sign-up/);
    expect(signupPosts).toHaveLength(1);

    const fresh = uniqueEmail("e2e-retry");
    await page.getByLabel(/email/i).fill(fresh);
    await page.getByRole("button", { name: /создать аккаунт|create account/i }).click();
    await expect(page).toHaveURL(/verify-email/);
    expect(signupPosts).toHaveLength(2);
    const delivery = await latestDelivery(request, "email", fresh);
    expect(delivery.otp).toHaveLength(6);
  });

  test("shows a localized invalid OTP error, locks after attempts, and shows resend cooldown", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("e2e-otp");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await latestDelivery(request, "email", email);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await fillOtp(page, "000000");
      await confirmCodeButton(page).click();
    }

    await expect(formAlert(page)).toContainText(
      /неверный код|invalid code|слишком много попыток|too many attempts/i,
    );
    await expect(page.getByRole("button", { name: /повторно через|another code later|resend/i })).toBeDisabled();
  });
});
