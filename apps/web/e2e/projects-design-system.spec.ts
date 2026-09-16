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

test("projects preserve master detail and responsive presentation after Design System 2026 migration", async ({ page, request }) => {
  const email = uniqueEmail("e2e-projects-design-system");
  await signUp(page, { name: "Projects UI", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects");
  const list = page.getByTestId("projects-list-pane");
  await expect(list).toBeVisible();

  await list.getByRole("button", { name: /создать проект|create project/i }).click();
  await page.getByLabel(/название|name/i).fill("Design System Project");
  await page.getByRole("dialog").getByRole("button", { name: /создать проект|create project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectUrl = page.url();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(projectUrl);

    await expect(page.getByTestId("project-detail-shell")).toBeVisible();

    if (viewport.width < 768) {
      await expect(page.getByTestId("projects-list-pane")).toBeHidden();
      await expect(page.getByRole("link", { name: /назад|back/i })).toBeVisible();
    } else {
      await expect(page.getByTestId("projects-list-pane")).toBeVisible();
      await expect(page.getByTestId("projects-list-pane").locator('a[aria-current="page"]')).toHaveCount(1);
    }

    await expect(page.getByRole("heading", { name: "Design System Project" })).toBeVisible();
    await assertNoDocumentOverflow(page);
  }
});
