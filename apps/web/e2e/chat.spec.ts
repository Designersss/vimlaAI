import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, startNewConversation } from "./helpers";

test.describe("AI verification gate", () => {
  test("unverified users are sent to verify-email instead of chat", async ({ page }) => {
    await signUp(page, {
      name: "Ada",
      email: uniqueEmail("e2e-unverified"),
      password: "correct-horse-battery",
    });
    await page.goto("/app");
    await expect(page).toHaveURL(/verify-email/);
    await expect(page.getByRole("heading", { name: /подтвердите email|verify/i })).toBeVisible();
  });

  test("verified users with usage stream a mock assistant reply", async ({ page, request }) => {
    const email = uniqueEmail("e2e-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await startNewConversation(page);
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    await expect(composer).toBeVisible();
    await composer.fill("Hello");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    await expect(page.getByText("Hello from Vimla")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^pro ·|^про ·/i }).click();
    await expect(page.getByRole("menuitem", { name: /^pro$|^про$/i })).toBeVisible();
    await expect(page.getByText(/auto routing is not available|auto-маршрутизация пока недоступна/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /◆ @vimla/i })).toHaveCount(0);
  });

  test("contextual @ picker filters, highlights exact handles, autocompletes and stays usable on mobile", async ({ page, request }) => {
    const email = uniqueEmail("e2e-mentions");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await startNewConversation(page);

    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    const picker = page.getByTestId("mention-picker");

    await composer.fill("@");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { name: /@vimla/i })).toBeVisible();
    await expect(picker.getByRole("option", { name: /@auto/i })).toBeVisible();

    await composer.fill("@a");
    await expect(picker.getByRole("option", { name: /@auto/i })).toBeVisible();

    await composer.fill("@vimla");
    await expect(picker.getByRole("option", { name: /@vimla/i })).toBeVisible();
    await expect(page.getByTestId("composer-mention-highlight")).toHaveText("@vimla");

    await composer.fill("@au");
    await expect(picker.getByRole("option", { name: /@auto/i })).toBeVisible();
    await composer.press("Enter");
    await expect(composer).toHaveValue("@auto ");
    await expect(page.getByTestId("composer-mention-highlight")).toHaveText("@auto");
    await expect(picker).toHaveCount(0);

    await composer.fill("@");
    await expect(picker).toBeVisible();
    await composer.press("Escape");
    await expect(picker).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await composer.fill("@au");
    await expect(picker).toBeVisible();
    const box = await picker.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - 844)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await picker.getByRole("option", { name: /@auto/i }).click();
    await expect(composer).toHaveValue("@auto ");
    await expect(page.getByTestId("composer-mention-highlight")).toHaveText("@auto");
    await expect(composer).toBeFocused();
  });

  test("manually typed exact @vimla resolves into orchestration without picker selection", async ({ page, request }) => {
    const email = uniqueEmail("e2e-typed-route");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await startNewConversation(page);

    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
    const send = page.getByRole("button", { name: /отправить|send/i });

    await composer.fill("@vimla");
    await expect(page.getByTestId("composer-mention-highlight")).toHaveText("@vimla");
    await composer.pressSequentially(" typed action");
    await expect(page.getByTestId("composer-mention-highlight")).toHaveText("@vimla");
    await send.click();

    await expect(
      page.locator("p").filter({ hasText: /^@vimla typed action$/ }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Hello from Vimla")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /◆ @vimla/i })).toHaveCount(0);

    await composer.fill("@unknown plain text");
    await expect(page.getByTestId("composer-mention-highlight")).toHaveCount(0);
    await send.click();
    await expect(page.getByText("Hello from Vimla")).toBeVisible({ timeout: 20_000 });
  });
});
