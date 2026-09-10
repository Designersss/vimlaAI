import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";

async function hideNextDevOverlays(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal, [data-next-badge-root] { display: none !important; }",
  });
}

test.describe("visual regression", () => {
  test.skip(!!process.env.CI, "Pixel snapshots are OS-specific; CI keeps behavioral tests.");

  test.use({
    viewport: { width: 1280, height: 800 },
  });

  test("auth shell", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /войти|sign in/i })).toBeVisible();
    await hideNextDevOverlays(page);
    await expect(page).toHaveScreenshot("auth-shell.png", { animations: "disabled" });
  });

  test("UI catalog", async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Vimla UI catalog" })).toBeVisible();
    await hideNextDevOverlays(page);
    await expect(page).toHaveScreenshot("dev-ui.png", {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("chat empty shell", async ({ page, request }) => {
    const email = uniqueEmail("e2e-visual-chat");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await hideNextDevOverlays(page);
    await expect(page).toHaveScreenshot("chat-empty-shell.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
      mask: [page.getByTestId("session-email"), page.locator("p").filter({ hasText: /example\.com/ })],
    });
  });

  test("settings shell", async ({ page, request }) => {
    const email = uniqueEmail("e2e-visual-settings");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: /безопасность|security/i, level: 1 })).toBeVisible();
    await hideNextDevOverlays(page);
    await expect(page).toHaveScreenshot("settings-shell.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
      mask: [page.getByTestId("session-email"), page.getByTestId("security-identity")],
    });
  });
});
