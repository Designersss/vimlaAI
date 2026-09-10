import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";

test.describe("visual regression", () => {
  test.skip(!!process.env.CI, "Pixel snapshots are OS-specific; CI keeps behavioral tests.");

  test.use({
    viewport: { width: 1280, height: 800 },
  });

  test("auth shell", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
    await expect(page).toHaveScreenshot("auth-shell.png", { animations: "disabled" });
  });

  test("UI catalog", async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Vimla UI catalog" })).toBeVisible();
    await expect(page).toHaveScreenshot("dev-ui.png", {
      animations: "disabled",
      fullPage: true,
    });
  });

  test("chat empty shell", async ({ page, request }) => {
    const email = uniqueEmail("e2e-visual-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await expect(page).toHaveScreenshot("chat-empty-shell.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    });
  });

  test("settings shell", async ({ page, request }) => {
    const email = uniqueEmail("e2e-visual-settings");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: /безопасность|security/i })).toBeVisible();
    await expect(page).toHaveScreenshot("settings-shell.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    });
  });
});
