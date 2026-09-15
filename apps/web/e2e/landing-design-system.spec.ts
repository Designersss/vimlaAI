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

test("landing preserves primary conversion paths across the responsive matrix", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in|войти/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up|регистрация|создать/i })).toBeVisible();
    await assertNoDocumentOverflow(page);
  }
});

test("landing CTAs keep their canonical auth routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: /sign in|войти/i })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("link", { name: /sign up|регистрация|создать/i })).toHaveAttribute("href", "/sign-up");
});
