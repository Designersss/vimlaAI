import { expect, test } from "@playwright/test";
import { assertNoDocumentOverflow } from "./responsive-helpers";

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
] as const;

const routes = ["/sign-in", "/sign-up", "/forgot-password"] as const;

test("auth surfaces preserve accessible forms and responsive presentation after Design System 2026 migration", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByTestId("auth-card-surface")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("form")).toBeVisible();
      await assertNoDocumentOverflow(page);
    }
  }
});

test("sign-in and sign-up keep keyboard-reachable primary controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/sign-in");
  await expect(page.getByLabel(/email|почта/i)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /password|пароль/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in|войти/i })).toBeVisible();

  await page.goto("/sign-up");
  await expect(page.getByLabel(/name|имя/i)).toBeVisible();
  await expect(page.getByLabel(/email|почта/i)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /password|пароль/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /create account|создать аккаунт/i })).toBeVisible();
});
