import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

const publicRoutes = ["/", "/sign-in", "/sign-up", "/forgot-password"] as const;
const publicViewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const authenticatedRoutes = ["/app", "/projects", "/work", "/settings"] as const;
const authenticatedViewports = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

test("public web surfaces remain overflow-safe with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of publicViewports) {
    await page.setViewportSize(viewport);

    for (const route of publicRoutes) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await assertNoDocumentOverflow(page);
    }
  }
});

test("authenticated primary surfaces remain reachable across the release matrix", async ({ page, request }) => {
  const email = uniqueEmail("web-production-readiness");
  await signUp(page, { name: "Web Readiness", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  for (const viewport of authenticatedViewports) {
    await page.setViewportSize(viewport);

    for (const route of authenticatedRoutes) {
      await page.goto(route);
      await expect(page.getByTestId("consumer-shell")).toBeVisible();
      await assertNoDocumentOverflow(page);
    }
  }
});
