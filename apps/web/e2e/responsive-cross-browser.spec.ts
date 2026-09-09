import { expect, test } from "@playwright/test";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test("auth shell has no document overflow", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /войти|sign in/i })).toBeVisible();
  await assertNoDocumentOverflow(page);
});

test("UI catalog shell is reachable in test", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { name: "Vimla UI catalog" })).toBeVisible();
  await assertNoDocumentOverflow(page);
});
