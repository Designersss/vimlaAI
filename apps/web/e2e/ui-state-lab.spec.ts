import { expect, test } from "@playwright/test";
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

test("Design System 2026 state lab exposes shared component states and theme parity", async ({ page }) => {
  await page.goto("/dev/ui");

  for (const heading of [
    "Design System 2026 foundation",
    "Actions",
    "Form controls",
    "Navigation primitives",
    "Surfaces and feedback",
    "Overlays",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const loadingButton = page.getByRole("button", { name: "Loading" });
  await expect(loadingButton).toBeDisabled();
  await expect(loadingButton).toHaveAttribute("aria-busy", "true");

  const invalidEmail = page.getByLabel("Invalid email");
  await expect(invalidEmail).toHaveAttribute("aria-invalid", "true");
  await expect(invalidEmail).toHaveAttribute("aria-errormessage", "catalog-email-invalid-error");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await assertNoDocumentOverflow(page);

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await assertNoDocumentOverflow(page);
});

test("shared overlays remain interactive and viewport safe", async ({ page }) => {
  await page.goto("/dev/ui");

  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Dialog" });
  await expect(dialog).toBeVisible();
  await assertNoDocumentOverflow(page);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(page.getByText("Navigation sheet")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Menu action" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Disabled action" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Popover" }).click();
  await expect(page.getByText("Popover content")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Popover content")).toBeHidden();

  await page.getByRole("button", { name: "Tooltip target" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Shared tooltip");
});

test("Design System 2026 state lab has no document overflow across representative viewports", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();
    await assertNoDocumentOverflow(page);
  }
});
