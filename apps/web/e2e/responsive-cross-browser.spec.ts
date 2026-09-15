import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test("auth shell has no document overflow", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /войти|sign in/i })).toBeVisible();
  await assertNoDocumentOverflow(page);
});

test("UI catalog exposes the Design System 2026 foundation without overflow", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { name: "Vimla UI catalog" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Design System 2026 foundation" })).toBeVisible();
  await expect(page.getByLabel("Semantic surface tokens")).toBeVisible();
  await expect(page.getByLabel("Typography specimen")).toBeVisible();
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

test("chat master-detail navigation preserves the list across browser engines", async ({ page, request }) => {
  const email = uniqueEmail("e2e-chat-layout-browser");
  await signUp(page, { name: "Layout", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
  const list = page.getByRole("region", { name: /список разговоров|conversation list/i, includeHidden: true });
  await expect(list).toBeVisible();
  const original = await list.elementHandle();
  await list.getByRole("button", { name: /новый разговор|new conversation/i }).click();
  await expect(page.getByPlaceholder(/сообщение для vimla|message vimla/i)).toBeVisible();
  await expect(page).toHaveURL(/\/app\/[^/]+$/);
  expect(await original?.evaluate((el) => el.isConnected)).toBe(true);
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await expect(list).toBeHidden();
    await page.getByRole("link", { name: /назад|back/i }).click();
    await expect(page).toHaveURL("/app");
    await expect(list).toBeVisible();
  } else {
    await expect(list).toBeVisible();
  }
  await assertNoDocumentOverflow(page);
});
