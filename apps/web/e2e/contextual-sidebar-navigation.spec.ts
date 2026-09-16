import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test("desktop and tablet use one contextual left pane with a section dock", async ({ page, request }) => {
  const email = uniqueEmail("e2e-context-sidebar");
  await signUp(page, { name: "Context Sidebar", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/app");

    const dock = page.getByTestId("desktop-section-dock");
    await expect(dock).toBeVisible();
    await expect(dock.locator('a[href="/app"][aria-current="page"]')).toBeVisible();
    await expect(dock.locator('a[href="/settings/account"]')).toBeVisible();
    await assertNoDocumentOverflow(page);

    await dock.locator('a[href="/settings/account"]').click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByTestId("settings-navigation-pane")).toBeVisible();
    await expect(page.getByTestId("desktop-section-dock").locator('a[href="/settings/account"][aria-current="page"]')).toBeVisible();
    await assertNoDocumentOverflow(page);

    await page.getByTestId("desktop-section-dock").locator('a[href="/work"]').click();
    await expect(page).toHaveURL(/\/work$/);
    await expect(page.getByTestId("work-navigation")).toBeVisible();
    await expect(page.getByTestId("desktop-section-dock").locator('a[href="/work"][aria-current="page"]')).toBeVisible();
    await assertNoDocumentOverflow(page);
  }
});

test("mobile keeps bottom navigation and hides the desktop dock", async ({ page, request }) => {
  const email = uniqueEmail("e2e-context-sidebar-mobile");
  await signUp(page, { name: "Context Mobile", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page.getByTestId("desktop-section-dock")).toBeHidden();
  const mobileNav = page.locator("nav:visible").filter({ has: page.locator('a[href="/app"]') });
  await expect(mobileNav).toHaveCount(1);
  await expect(mobileNav.locator('a[href="/settings/account"]')).toBeVisible();
  await assertNoDocumentOverflow(page);
});
