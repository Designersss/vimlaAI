import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@vimla/database";
import { AdminControlService, ADMIN_COOKIE_NAME } from "@vimla/admin";
import { seedVimlaPlans } from "@vimla/billing";

const apiBase = process.env.BETTER_AUTH_URL ?? "http://localhost:3201";
const adminOrigin = process.env.ADMIN_ORIGIN ?? "http://localhost:3202";
const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgresql://vimla:vimla@localhost:5432/vimla_test";

async function bootstrapOwnerSession(page: Page): Promise<{ token: string }> {
  const prisma = createPrismaClient(databaseUrl);
  await seedVimlaPlans(prisma);
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Owner",
      email: `owner-${randomUUID()}@example.com`,
      emailVerified: true,
    },
  });
  const control = new AdminControlService(prisma, {
    secret: process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min",
    ttlSeconds: 28800,
    idleSeconds: 1800,
    stepUpSeconds: 900,
    requireTotp: true,
    requirePasskey: false,
    cookieSecure: false,
  });
  await control.bootstrapOwner(user.id);
  const session = await control.createSession({ userId: user.id });
  await prisma.$disconnect();
  await page.context().addCookies([
    {
      name: ADMIN_COOKIE_NAME,
      value: session.token,
      url: apiBase,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
  return { token: session.token };
}

test("unauthenticated visitor cannot open the admin dashboard", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/sign-in/, { timeout: 20_000 });
});

test("owner admin session sees finance overview and top-up has no expiry", async ({ page }) => {
  await bootstrapOwnerSession(page);
  await page.goto("/admin");
  await expect(page.getByTestId("outstanding-topup")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/top-up outstanding|непогашенное пополнение/i).first()).toBeVisible();
  await page.goto("/admin/tariffs/top-up");
  await expect(page.getByTestId("topup-no-expiry")).toBeVisible();
  await expect(page.locator("input[name='expiry']")).toHaveCount(0);
});

test("owner can create a draft, simulate and publish T199", async ({ page, request }) => {
  const { token } = await bootstrapOwnerSession(page);
  await page.goto("/admin/tariffs");
  await page.getByTestId("create-draft-T199").click();
  const status = page.getByRole("status");
  await expect(status).toBeVisible({ timeout: 20_000 });
  const draftId = ((await status.textContent()) ?? "").trim();
  expect(draftId.length).toBeGreaterThan(8);
  const simulated = await request.post(`${apiBase}/admin/v1/tariffs/plans/${draftId}/simulate`, {
    headers: {
      origin: adminOrigin,
      cookie: `${ADMIN_COOKIE_NAME}=${token}`,
    },
  });
  expect(simulated.ok()).toBeTruthy();
  const published = await request.post(`${apiBase}/admin/v1/tariffs/plans/${draftId}/publish`, {
    headers: {
      origin: adminOrigin,
      cookie: `${ADMIN_COOKIE_NAME}=${token}`,
      "content-type": "application/json",
    },
    data: {
      acknowledgeNegativeOrLowMargin: true,
      reason: "e2e publish",
      typedPlanCode: "T199",
    },
  });
  expect(published.ok()).toBeTruthy();
});

test("finance overview stays contained on a tablet viewport", async ({ page }) => {
  await bootstrapOwnerSession(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/admin");
  await expect(page.getByTestId("outstanding-topup")).toBeVisible({ timeout: 20_000 });
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflowing).toBeFalsy();
});

test.describe("visual regression", () => {
  test.skip(!!process.env.CI, "Pixel snapshots are OS-specific; CI keeps behavioral tests.");

  test.use({
    viewport: { width: 1280, height: 800 },
  });

  test("admin auth shell", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading")).toBeVisible();
    await expect(page).toHaveScreenshot("admin-auth-shell.png", { animations: "disabled" });
  });

  test("admin shell", async ({ page }) => {
    await bootstrapOwnerSession(page);
    await page.goto("/admin");
    await expect(page.getByTestId("outstanding-topup")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveScreenshot("admin-shell.png", { animations: "disabled" });
  });
});
