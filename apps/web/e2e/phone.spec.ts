import { expect, test } from "@playwright/test";
import {
  confirmCodeButton,
  fillOtp,
  formAlert,
  latestDelivery,
  otpGroup,
  seedLocale,
  sendCodeButton,
  signUp,
  uniqueEmail,
  uniquePhone,
  verifyEmail,
} from "./helpers";

test.describe("phone identity", () => {
  test("links a verified phone and signs in with SMS OTP", async ({ page, request }) => {
    const email = uniqueEmail("e2e-phone");
    const password = "correct-horse-battery";
    const phone = uniquePhone();
    await signUp(page, { name: "Ada", email, password });
    await verifyEmail(page, request, email);

    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: /безопасность|security/i })).toBeVisible();
    await page.locator("#security-phone").fill(phone);
    await page.locator("#security-send-phone").click();
    await expect(otpGroup(page)).toBeVisible();
    const sms = await latestDelivery(request, "sms", phone);
    await fillOtp(page, sms.otp ?? "");
    await confirmCodeButton(page).click();
    await expect(page.getByRole("status")).toContainText(/номер подтверждён|phone/i);

    await page.goto("/app");
    await page.getByRole("button", { name: /выйти|sign out/i }).click();
    await page.waitForTimeout(2500);

    await page.goto("/sign-in");
    await page.getByRole("tab", { name: /телефон|phone/i }).click();
    await page.locator("#phone-sign-in").fill(phone);
    await sendCodeButton(page).click();
    const loginSms = await latestDelivery(request, "sms", phone, { ignoreOtp: sms.otp });
    await fillOtp(page, loginSms.otp ?? "");
    await confirmCodeButton(page).click();
    await expect(page).toHaveURL(/\/app/);
  });

  test("does not create an account for an unknown phone", async ({ page }) => {
    await seedLocale(page, "ru");
    await page.goto("/sign-in");
    await page.getByRole("tab", { name: /телефон|phone/i }).click();
    await page.locator("#phone-sign-in").fill(uniquePhone());
    await sendCodeButton(page).click();
    await fillOtp(page, "000000");
    await confirmCodeButton(page).click();
    await expect(formAlert(page)).toBeVisible();
    await expect(page).not.toHaveURL(/\/app/);
  });
});
