import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("projects", () => {
  test("creates a project, opens it, and shows members", async ({ page, request }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-projects");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);

    await page.goto("/projects");
    await expect(page.getByTestId("projects-shell")).toBeVisible();
    await expect(page.getByRole("link", { name: /проекты|projects/i }).first()).toBeVisible();
    await page.getByLabel(/название|name/i).fill("Atlas");
    await page.getByRole("button", { name: /создать проект|create project/i }).click();
    await expect(page.getByRole("link", { name: /atlas/i })).toBeVisible();
    await page.getByRole("link", { name: /atlas/i }).click();
    await expect(page.getByRole("heading", { name: "Atlas" })).toBeVisible();
    await page.getByRole("link", { name: /участники|members/i }).click();
    await expect(page.getByRole("heading", { name: /участники|members/i })).toBeVisible();
    await expect(page.getByTestId("projects-shell").getByText(email)).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("projects shell fits representative viewports", async ({ page, request }) => {
    const email = uniqueEmail("e2e-projects-responsive");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await page.goto("/projects");
    await page.getByLabel(/название|name/i).fill("Viewport");
    await page.getByRole("button", { name: /создать проект|create project/i }).click();
    await page.getByRole("link", { name: /viewport/i }).click();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("projects-shell")).toBeVisible();
      await assertReachable(page, page.getByRole("link", { name: /участники|members/i }));
      await assertNoDocumentOverflow(page);
    }
  });
});
