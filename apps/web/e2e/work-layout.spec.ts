import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

async function createVerifiedUser(page: Page, request: Parameters<typeof verifyEmail>[1], prefix: string): Promise<void> {
  const email = uniqueEmail(prefix);
  await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
}

async function createNote(page: Page, title: string): Promise<string> {
  await page.goto("/work/notes");
  await page.locator("#note-title").fill(title);
  await page.getByRole("button", { name: /создать|create/i }).click();
  await expect(page).toHaveURL(/\/work\/notes\/[^/]+$/);
  return page.url();
}

async function createList(page: Page, title: string): Promise<string> {
  await page.goto("/work/lists");
  await page.locator("#list-title").fill(title);
  await page.locator("#list-type").selectOption("CHECKLIST");
  await page.getByRole("button", { name: /создать|create/i }).click();
  await expect(page).toHaveURL(/\/work\/lists\/[^/]+$/);
  return page.url();
}

test.describe("persistent Work layouts", () => {
  test("Work navigation persists while Tasks and Reminders remain single-pane", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createVerifiedUser(page, request, "e2e-work-layout");
    await page.goto("/work");

    const navigation = page.getByTestId("work-navigation");
    await expect(navigation).toBeVisible();
    const navigationHandle = await navigation.elementHandle();

    for (const href of ["/work/tasks", "/work/reminders", "/work/notes", "/work/lists", "/work"]) {
      await navigation.locator(`a[href="${href}"]`).click();
      await expect(page).toHaveURL(href);
      expect(await navigationHandle?.evaluate((element) => element.isConnected)).toBe(true);
      await expect(page.getByTestId("work-navigation")).toHaveCount(1);
    }

    await page.goto("/work/tasks");
    await expect(page.locator('a[href^="/work/tasks/"]')).toHaveCount(0);
    await page.goto("/work/reminders");
    await expect(page.locator('a[href^="/work/reminders/"]')).toHaveCount(0);
    await assertNoDocumentOverflow(page);
  });

  test("Notes keep the collection mounted on desktop and use deterministic mobile detail navigation", async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createVerifiedUser(page, request, "e2e-work-notes-layout");

    await page.goto("/work/notes");
    const master = page.getByTestId("work-notes-master");
    await expect(master).toBeVisible();
    const masterHandle = await master.elementHandle();
    await master.locator("#note-title").fill("Persistent note");
    await master.getByRole("button", { name: /создать|create/i }).click();
    await expect(page).toHaveURL(/\/work\/notes\/[^/]+$/);
    const noteUrl = page.url();

    const detail = page.getByTestId("work-note-detail");
    await expect(detail).toBeVisible();
    await expect(master).toBeVisible();
    expect(await masterHandle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(master.getByRole("link", { name: "Persistent note" })).toHaveAttribute("aria-current", "page");
    await expect(detail.getByTestId("work-detail-back")).toBeHidden();

    await detail.locator("#note-edit-title").fill("Renamed persistent note");
    await detail.locator("#note-content").fill("persistent body");
    await detail.getByRole("button", { name: /сохранить|save/i }).click();
    await expect(master.getByRole("link", { name: "Renamed persistent note" })).toBeVisible();
    expect(await masterHandle?.evaluate((element) => element.isConnected)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(noteUrl);
    await expect(page.getByTestId("work-note-detail")).toBeVisible();
    await expect(page.getByTestId("work-notes-master")).toBeHidden();
    const back = page.getByTestId("work-detail-back");
    await assertReachable(page, back);
    await page.reload();
    await expect(page).toHaveURL(noteUrl);
    await expect(page.getByTestId("work-note-detail")).toBeVisible();
    await back.click();
    await expect(page).toHaveURL("/work/notes");
    await expect(page.getByTestId("work-notes-master")).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("Lists keep the collection mounted on desktop and use deterministic mobile detail navigation", async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createVerifiedUser(page, request, "e2e-work-lists-layout");

    await page.goto("/work/lists");
    const master = page.getByTestId("work-lists-master");
    await expect(master).toBeVisible();
    const masterHandle = await master.elementHandle();
    await master.locator("#list-title").fill("Persistent list");
    await master.locator("#list-type").selectOption("CHECKLIST");
    await master.getByRole("button", { name: /создать|create/i }).click();
    await expect(page).toHaveURL(/\/work\/lists\/[^/]+$/);
    const listUrl = page.url();

    const detail = page.getByTestId("work-list-detail");
    await expect(detail).toBeVisible();
    await expect(master).toBeVisible();
    expect(await masterHandle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(master.getByRole("link", { name: "Persistent list" })).toHaveAttribute("aria-current", "page");
    await expect(detail.getByTestId("work-detail-back")).toBeHidden();
    await detail.locator("#list-item").fill("Item A");
    await detail.getByRole("button", { name: /добавить пункт|add item/i }).click();
    await expect(detail.getByText("Item A")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(listUrl);
    await expect(page.getByTestId("work-list-detail")).toBeVisible();
    await expect(page.getByTestId("work-lists-master")).toBeHidden();
    const back = page.getByTestId("work-detail-back");
    await assertReachable(page, back);
    await back.click();
    await expect(page).toHaveURL("/work/lists");
    await expect(page.getByTestId("work-lists-master")).toBeVisible();
    await assertNoDocumentOverflow(page);
  });

  test("nested Work master-detail remains usable across representative viewports", async ({ page, request }) => {
    test.setTimeout(180_000);
    await createVerifiedUser(page, request, "e2e-work-responsive");
    const noteUrl = await createNote(page, "Responsive note with a deliberately long title for layout coverage");
    const listUrl = await createList(page, "Responsive list with a deliberately long title for layout coverage");

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });

      for (const target of [
        { url: noteUrl, master: "work-notes-master", detail: "work-note-detail" },
        { url: listUrl, master: "work-lists-master", detail: "work-list-detail" },
      ]) {
        await page.goto(target.url);
        await expect(page.getByTestId(target.detail)).toBeVisible();
        if (viewport.width < 1024) {
          await expect(page.getByTestId(target.master)).toBeHidden();
          await assertReachable(page, page.getByTestId(target.detail).getByTestId("work-detail-back"));
        } else {
          await expect(page.getByTestId(target.master)).toBeVisible();
          await expect(page.getByTestId(target.detail).getByTestId("work-detail-back")).toBeHidden();
        }
        await assertNoDocumentOverflow(page);
      }
    }
  });
});
