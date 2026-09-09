import { expect, test } from "@playwright/test";

test("admin sign-in shell has no document overflow", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading")).toBeVisible();
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflowing).toBeFalsy();
});
