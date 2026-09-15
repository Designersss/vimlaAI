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

test("canonical app shell navigation preserves route state across representative viewports", async ({ page, request }) => {
  const email = uniqueEmail("e2e-shell-navigation");
  await signUp(page, { name: "Shell", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/work");

    await expect(page.getByTestId("consumer-shell")).toBeVisible();

    // Both desktop and mobile canonical navs stay mounted so route state remains
    // consistent across responsive composition. Assert against the nav that is
    // actually visible at the current viewport instead of matching both nodes.
    const canonicalNav = page
      .locator("nav:visible")
      .filter({ has: page.locator('a[href="/app"]') });

    await expect(canonicalNav).toHaveCount(1);
    await expect(canonicalNav).toBeVisible();
    await expect(canonicalNav.locator('a[href="/work"][aria-current="page"]')).toBeVisible();
    await expect(canonicalNav.locator('a[href="/app"][aria-current="page"]')).toHaveCount(0);

    if (viewport.width < 768) {
      await expect(page.locator("aside").first()).toBeHidden();
      await expect(canonicalNav.locator('a[href="/work"]')).toBeVisible();
    } else {
      await expect(page.locator("aside").first()).toBeVisible();
    }

    await assertNoDocumentOverflow(page);
  }
});
