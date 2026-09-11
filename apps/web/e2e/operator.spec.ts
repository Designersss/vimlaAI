import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("@Vimla operator", () => {
  test("creates a task, confirms a delete, and fits representative viewports", async ({ page, request }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-operator");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    const tz = await page.request.patch(`${apiBase}/v1/me/preferences`, {
      data: { timezone: "Europe/Moscow" },
      headers: { origin: webOrigin, "content-type": "application/json" },
    });
    expect(tz.status()).toBe(200);

    await page.goto("/vimla");
    await expect(page.getByTestId("operator-shell")).toBeVisible();
    await expect(page.getByText("@Vimla").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^pro ·|^про ·/i })).toHaveCount(0);

    const composer = page.getByPlaceholder(/попросите @vimla|ask @vimla/i);
    await expect(composer).toBeVisible();
    await composer.fill("@Vimla создай задачу купить билеты завтра");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    const created = page.getByTestId("operator-action-card").filter({ hasText: /билет|ticket/i });
    await expect(created).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/VIMLA_OPERATOR_PLANNER|"commands"|inputJson/)).toHaveCount(0);

    await composer.fill("@Vimla удали задачу");
    await page.getByRole("button", { name: /отправить|send/i }).click();
    const pending = page.getByTestId("operator-action-card").filter({ hasText: /подтвержден|confirm/i });
    await expect(pending).toBeVisible({ timeout: 20_000 });
    const confirm = page.getByRole("button", { name: /^(подтвердить|confirm)$/i });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page.getByText(/удален|deleted/i).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/work/tasks");
    await expect(page.getByText(/купить билеты|buy tickets/i)).toHaveCount(0);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/vimla");
      await expect(page.getByTestId("operator-shell")).toBeVisible();
      await assertReachable(page, page.getByRole("button", { name: /отправить|send/i }));
      await assertNoDocumentOverflow(page);
    }
  });
});
