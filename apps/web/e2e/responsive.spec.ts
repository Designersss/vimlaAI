import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

const VIEWPORTS = [
  { name: "small-mobile", width: 320, height: 568 },
  { name: "modern-mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
] as const;

test.describe("responsive smoke", () => {
  for (const viewport of VIEWPORTS) {
    test(`sign-in fits ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/sign-in");
      await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
      await assertReachable(page, page.getByRole("button", { name: /войти|sign in/i }));
      await assertNoDocumentOverflow(page);
    });
  }

  test("mobile chat uses a drawer and a reachable composer", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = uniqueEmail("e2e-responsive-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/app");
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    await expect(composer).toBeVisible();
    await assertReachable(page, page.getByRole("button", { name: /отправить|send/i }));
    await page.getByRole("button", { name: /открыть навигацию|open navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await assertNoDocumentOverflow(page);
  });

  test("settings and billing reflow on a phone", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = uniqueEmail("e2e-responsive-settings");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: /безопасность|security/i })).toBeVisible();
    await assertNoDocumentOverflow(page);
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { name: /оплата|billing/i })).toBeVisible();
    await assertNoDocumentOverflow(page);
    await page.goto("/settings/appearance");
    await expect(page.getByRole("heading", { name: /оформление|appearance/i })).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("UI catalog is available in test env", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Vimla UI catalog" })).toBeVisible();
    await assertNoDocumentOverflow(page);
  });
});
