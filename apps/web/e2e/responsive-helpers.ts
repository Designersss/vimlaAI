import { expect, type Page } from "@playwright/test";

export async function assertNoDocumentOverflow(page: Page): Promise<void> {
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflowing).toBeFalsy();
}

export async function assertReachable(page: Page, locator: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
}
