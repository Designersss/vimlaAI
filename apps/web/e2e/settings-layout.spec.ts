import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

async function createVerifiedUser(page: Page, request: Parameters<typeof verifyEmail>[1], prefix: string): Promise<void> {
  const email = uniqueEmail(prefix);
  await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
}

test.describe("settings persistent layout", () => {
  test("desktop keeps settings navigation mounted while switching sections", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createVerifiedUser(page, request, "e2e-settings-layout");

    await page.goto("/settings");
    const navigation = page.getByTestId("settings-navigation-pane");
    await expect(navigation).toBeVisible();
    const navigationHandle = await navigation.elementHandle();

    await navigation.getByRole("link", { name: /account|аккаунт|уч[её]тная запись/i }).click();
    await expect(page).toHaveURL("/settings/account");
    await expect(page.getByRole("heading", { name: /account|аккаунт|уч[её]тная запись/i }).last()).toBeVisible();
    expect(await navigationHandle?.evaluate((element) => element.isConnected)).toBe(true);

    await navigation.getByRole("link", { name: /appearance|оформление/i }).click();
    await expect(page).toHaveURL("/settings/appearance");
    await expect(page.getByRole("heading", { name: /appearance|оформление/i }).last()).toBeVisible();
    expect(await navigationHandle?.evaluate((element) => element.isConnected)).toBe(true);

    await navigation.getByRole("link", { name: /security|безопасность/i }).click();
    await expect(page).toHaveURL("/settings/security");
    await expect(page.getByRole("heading", { name: /security|безопасность/i }).last()).toBeVisible();
    expect(await navigationHandle?.evaluate((element) => element.isConnected)).toBe(true);
    await assertNoDocumentOverflow(page);
  });

  test("mobile uses settings menu and detail as deterministic route-selected panes", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await createVerifiedUser(page, request, "e2e-settings-mobile");

    await page.goto("/settings");
    const navigation = page.getByTestId("settings-navigation-pane");
    await expect(navigation).toBeVisible();

    await navigation.getByRole("link", { name: /account|аккаунт|уч[её]тная запись/i }).click();
    await expect(page).toHaveURL("/settings/account");
    await expect(navigation).toBeHidden();
    const detail = page.getByTestId("settings-detail");
    await expect(detail).toBeVisible();
    const back = detail.getByRole("link", { name: /back|назад/i });
    await assertReachable(page, back);

    await back.click();
    await expect(page).toHaveURL("/settings");
    await expect(navigation).toBeVisible();

    await page.goto("/settings/appearance");
    await expect(page.getByTestId("settings-detail")).toBeVisible();
    await expect(navigation).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL("/settings/appearance");
    await expect(page.getByTestId("settings-detail")).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("settings layout fits representative viewports", async ({ page, request }) => {
    test.setTimeout(120_000);
    await createVerifiedUser(page, request, "e2e-settings-responsive");

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
      await page.goto("/settings/account");
      await expect(page.getByTestId("settings-detail")).toBeVisible();
      const navigation = page.getByTestId("settings-navigation-pane");
      if (viewport.width < 1024) {
        await expect(navigation).toBeHidden();
        await assertReachable(page, page.getByTestId("settings-detail").getByRole("link", { name: /back|назад/i }));
      } else {
        await expect(navigation).toBeVisible();
        await expect(page.getByTestId("settings-detail").getByRole("link", { name: /back|назад/i })).toBeHidden();
      }
      await assertNoDocumentOverflow(page);
    }
  });
});
