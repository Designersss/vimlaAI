import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
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

test("My Work shell is reachable after sign-in", async ({ page, request }) => {
  const email = uniqueEmail("e2e-work-smoke");
  await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
  await page.goto("/work");
  await expect(page.getByTestId("work-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: /сегодня|today/i })).toBeVisible();
  await assertNoDocumentOverflow(page);
});
