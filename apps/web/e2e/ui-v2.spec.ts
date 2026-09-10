import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test.describe("UI system v2", () => {
  test("auth split layout, appearance, messages drill-down and composer gating", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /ваши идеи|your ideas/i })).toBeVisible();
    await assertNoDocumentOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /ваши идеи|your ideas/i })).toHaveCount(0);
    await assertNoDocumentOverflow(page);

    const email = uniqueEmail("e2e-ui-v2");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);

    await page.goto("/settings/appearance");
    await page.getByRole("radio", { name: /тёмная|dark/i }).check();
    await page.getByRole("radio", { name: /светлая|light/i }).check();
    await page.getByRole("radio", { name: /системная|system/i }).check();
    await assertNoDocumentOverflow(page);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /сообщения|messages/i, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /новый разговор|new conversation/i }).click();
    await expect(page.getByPlaceholder(/сообщение для vimla|message vimla/i)).toBeVisible();
    await page.getByRole("button", { name: /◆ @vimla/i }).focus();
    await expect(page.getByRole("button", { name: /◆ @vimla/i })).toBeFocused();
    await page.getByRole("button", { name: /◆ @vimla/i }).click();
    await expect(page.getByText("◆ @Vimla").first()).toBeVisible();
    await page.getByRole("button", { name: /^pro ·/i }).click();
    await expect(page.getByRole("menuitem", { name: /^auto$/i })).toBeDisabled();
    await assertNoDocumentOverflow(page);
  });
});
