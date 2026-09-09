import { expect, test } from "@playwright/test";

test("admin auth shell fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.getByRole("button", { name: /войти|sign in/i })).toBeVisible();
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflowing).toBeFalsy();
});
