import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
] as const;

test("settings navigation remains responsive after Design System 2026 migration", async ({ page, request }) => {
  const email = uniqueEmail("e2e-settings-design-system");
  await signUp(page, { name: "Settings UI", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/settings");

    const navigationPane = page.getByTestId("settings-navigation-pane");
    await expect(navigationPane).toBeVisible();
    await assertNoDocumentOverflow(page);

    await navigationPane.locator('a[href="/settings/account"]').click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByTestId("settings-detail")).toBeVisible();

    if (viewport.width < 768) {
      await expect(navigationPane).toBeHidden();
      await expect(page.getByRole("link", { name: /назад|back/i })).toBeVisible();
    } else {
      await expect(navigationPane).toBeVisible();
      await expect(navigationPane.locator('a[href="/settings/account"][aria-current="page"]')).toHaveCount(1);
    }

    await assertNoDocumentOverflow(page);
  }
});
