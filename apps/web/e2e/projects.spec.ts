import { expect, test, type Page } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

const master = (page: Page) => page.getByRole("region", { name: /^(проекты|projects)$/i, includeHidden: true });
const detail = (page: Page) => page.getByRole("region", { name: /^(обзор|overview)$/i, includeHidden: true });

async function createProject(page: Page, name: string): Promise<string> {
  await master(page).getByRole("button", { name: /создать проект|create project/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/название|name/i).fill(name);
  await dialog.getByRole("button", { name: /создать проект|create project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  const href = await page
    .getByTestId("projects-list-pane")
    .locator("a")
    .filter({ hasText: name })
    .getAttribute("href");
  if (!href) throw new Error("Created project link is missing");
  return href;
}

test.describe("projects", () => {
  test("desktop keeps the project list mounted across overview and members routes", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = uniqueEmail("e2e-projects");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);

    await page.goto("/projects");
    await expect(page.getByTestId("projects-shell")).toBeVisible();
    await expect(master(page)).toBeVisible();
    await expect(detail(page)).toBeVisible();

    const firstHref = await createProject(page, "Atlas");
    await expect(page.getByRole("heading", { name: "Atlas" })).toBeVisible();
    await expect(master(page)).toBeVisible();
    await expect(master(page).getByRole("link", { name: "Atlas", exact: true })).toHaveAttribute("aria-current", "page");

    await page.goto("/projects");
    const secondHref = await createProject(page, "Borealis");
    expect(secondHref).not.toBe(firstHref);

    const shellHandle = await page.getByTestId("consumer-shell").elementHandle();
    const masterHandle = await master(page).elementHandle();
    await master(page).getByRole("link", { name: "Atlas", exact: true }).click();
    await expect(page).toHaveURL(firstHref);
    expect(await shellHandle?.evaluate((element) => element.isConnected)).toBe(true);
    expect(await masterHandle?.evaluate((element) => element.isConnected)).toBe(true);

    await detail(page).getByRole("link", { name: /участники|members/i }).click();
    await expect(page).toHaveURL(`${firstHref}/members`);
    await expect(page.getByRole("heading", { name: /участники|members/i })).toBeVisible();
    await expect(page.getByTestId("project-detail-shell").getByText(email)).toBeVisible();
    expect(await masterHandle?.evaluate((element) => element.isConnected)).toBe(true);
    await assertNoDocumentOverflow(page);
  });

  test("mobile uses project list and detail as separate route-selected panes with deterministic back", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const email = uniqueEmail("e2e-projects-mobile");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);

    await page.goto("/projects");
    await expect(master(page)).toBeVisible();
    await expect(detail(page)).toBeHidden();

    const href = await createProject(page, "Mobile Atlas");
    await expect(master(page)).toBeHidden();
    await expect(detail(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mobile Atlas" })).toBeVisible();
    await assertReachable(page, detail(page).getByRole("link", { name: /назад|back/i }));

    await detail(page).getByRole("link", { name: /назад|back/i }).click();
    await expect(page).toHaveURL("/projects");
    await expect(master(page)).toBeVisible();
    await expect(detail(page)).toBeHidden();

    await page.goto(href);
    await expect(detail(page)).toBeVisible();
    await expect(master(page)).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL(href);
    await expect(detail(page)).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("projects master-detail fits the representative viewport matrix", async ({ page, request }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-projects-responsive");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/projects");
    const href = await createProject(page, "Viewport project with a deliberately long project name");

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(href);
      await expect(detail(page)).toBeVisible();
      if (viewport.width < 1024) {
        await expect(master(page)).toBeHidden();
        await assertReachable(page, detail(page).getByRole("link", { name: /назад|back/i }));
      } else {
        await expect(master(page)).toBeVisible();
        await expect(detail(page).getByRole("link", { name: /назад|back/i })).toBeHidden();
      }
      await assertReachable(page, detail(page).getByRole("link", { name: /участники|members/i }));
      await assertNoDocumentOverflow(page);
    }
  });
});
