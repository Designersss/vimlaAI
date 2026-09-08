import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3100";
export const apiBase = process.env.BETTER_AUTH_URL ?? "http://localhost:3101";

export function formAlert(page: Page): Locator {
  return page.locator("p[role='alert']");
}

export function otpGroup(page: Page): Locator {
  return page.getByRole("group", { name: /код подтверждения|verification code/i });
}

export function confirmCodeButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(подтвердить|confirm)$/i });
}

export function sendCodeButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(отправить код|send code)$/i });
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

export function uniquePhone(): string {
  const suffix = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  return `+7900${suffix}`;
}

export async function fillOtp(page: Page, code: string): Promise<void> {
  const group = otpGroup(page);
  await expect(group).toBeVisible();
  const inputs = group.locator("input");
  for (let index = 0; index < code.length; index += 1) {
    await inputs.nth(index).fill(code[index] ?? "");
  }
}

export async function latestDelivery(
  request: APIRequestContext,
  channel: "email" | "sms",
  to: string,
  options?: { ignoreOtp?: string | null; requireResetUrl?: boolean },
): Promise<{ otp: string | null; resetUrl: string | null; templateId: string | null }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request.get(`${apiBase}/dev/notifications/latest`, {
      params: { channel, to },
    });
    if (response.ok()) {
      const body = (await response.json()) as {
        otp: string | null;
        resetUrl: string | null;
        templateId: string | null;
      };
      if (options?.requireResetUrl) {
        if (body.resetUrl) {
          return body;
        }
      } else if (body.otp && body.otp !== options?.ignoreOtp) {
        return body;
      } else if (body.resetUrl) {
        return body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`No ${channel} delivery for ${to}`);
}

export async function switchLocale(page: Page, locale: "ru" | "en"): Promise<void> {
  const label = locale === "en" ? "English" : "Русский";
  const button = page.getByRole("button", { name: label });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

export async function seedLocale(page: Page, locale: "ru" | "en"): Promise<void> {
  await page.context().addCookies([
    {
      name: "vimla_locale",
      value: locale,
      url: webOrigin,
    },
  ]);
}

export async function signUp(
  page: Page,
  input: { name: string; email: string; password: string },
  locale: "ru" | "en" = "ru",
): Promise<void> {
  await seedLocale(page, locale);
  await page.goto("/sign-up");
  await page.getByLabel(/имя|name/i).fill(input.name);
  await page.getByLabel(/email/i).fill(input.email);
  await page.locator("#auth-password").fill(input.password);
  await page.getByRole("button", { name: /создать аккаунт|create account/i }).click();
  await expect(page).toHaveURL(/verify-email/);
}

export async function verifyEmail(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const delivery = await latestDelivery(request, "email", email);
  expect(delivery.otp).toHaveLength(6);
  await fillOtp(page, delivery.otp ?? "");
  await confirmCodeButton(page).click();
  await expect(page).toHaveURL(/\/app/);
}

export async function signInEmail(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: /войти|sign in/i }).click();
}

export async function purchasePro(page: Page): Promise<void> {
  const response = await page.request.post(`${apiBase}/dev/mock-purchases/subscription`, {
    data: { planCode: "PRO" },
    headers: { origin: webOrigin },
  });
  expect(response.status()).toBe(201);
}
