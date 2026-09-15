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

test("chat master detail remains responsive after Design System 2026 migration", async ({ page, request }) => {
  const email = uniqueEmail("e2e-chat-design-system");
  await signUp(page, { name: "Chat UI", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/app");

    const list = page.getByRole("region", { name: /список разговоров|conversation list/i, includeHidden: true });
    const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);

    await expect(list).toBeVisible();
    await assertNoDocumentOverflow(page);

    await list.getByRole("button", { name: /новый разговор|new conversation/i }).click();
    await expect(page).toHaveURL(/\/app\/[^/]+$/);
    await expect(composer).toBeVisible();

    if (viewport.width < 1024) {
      await expect(list).toBeHidden();
      await expect(page.getByRole("link", { name: /назад|back/i })).toBeVisible();
    } else {
      await expect(list).toBeVisible();
      await expect(list.locator('a[aria-current="page"]')).toHaveCount(1);
    }

    await assertNoDocumentOverflow(page);
  }
});
