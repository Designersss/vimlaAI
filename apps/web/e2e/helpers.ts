import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3100";
export const apiBase = process.env.BETTER_AUTH_URL ?? "http://localhost:3101";

export function formAlert(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
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
  channel: "email",
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

export async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  await field.click();
  await field.fill(value);
  if ((await field.inputValue()) !== value) {
    await field.clear();
    await field.pressSequentially(value, { delay: 20 });
  }
  await expect(field).toHaveValue(value);
}

export async function signUp(
  page: Page,
  input: { name: string; email: string; password: string },
  locale: "ru" | "en" = "ru",
): Promise<void> {
  await seedLocale(page, locale);
  await page.goto("/sign-up");
  await fillInput(page, "#auth-name", input.name);
  await fillInput(page, "#auth-email", input.email);
  await fillInput(page, "#auth-password", input.password);
  await page.getByRole("button", { name: /создать аккаунт|create account/i }).click();
  await expect(page).toHaveURL(/verify-email/, { timeout: 30_000 });
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

export async function createDueReminder(
  page: Page,
  title: string,
  options?: { timezone?: string; dueMsAgo?: number },
): Promise<void> {
  const scheduledAt = new Date(Date.now() - (options?.dueMsAgo ?? 60_000)).toISOString();
  const response = await page.request.post(`${apiBase}/v1/workspace/reminders`, {
    data: {
      title,
      scheduledAt,
      timezone: options?.timezone ?? "Europe/Moscow",
    },
    headers: { origin: webOrigin, "content-type": "application/json" },
  });
  expect(response.status()).toBe(201);
}

export async function purchasePro(page: Page): Promise<void> {
  const response = await page.request.post(`${apiBase}/dev/mock-purchases/subscription`, {
    data: { planCode: "PRO" },
    headers: { origin: webOrigin },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { subscriptionId: string | null };
  expect(body.subscriptionId).toBeTruthy();
}

export function pageHeading(page: Page, name: RegExp): Locator {
  return page.getByRole("heading", { name, level: 1 });
}

export async function startNewConversation(page: Page): Promise<void> {
  await page.goto("/app");
  await expect(pageHeading(page, /сообщения|messages/i)).toBeVisible();
  await page.getByRole("button", { name: /новый разговор|new conversation/i }).click();
  await expect(page.getByPlaceholder(/сообщение для vimla|message vimla/i)).toBeVisible();
}
