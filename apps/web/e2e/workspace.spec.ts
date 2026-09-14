import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test.describe("personal workspace", () => {
  test("manages tasks and reminders and surfaces due items in today", async ({ page, request }) => {
    test.setTimeout(60_000);
    const email = uniqueEmail("e2e-work-today");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);

    await page.goto("/work");
    await expect(page.getByTestId("work-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: /сегодня|today/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /мои дела|my work/i }).first()).toBeVisible();
    await expect(page.getByText(/@vimla|project brain|library/i)).toHaveCount(0);

    await page.getByRole("link", { name: /задачи|tasks/i }).first().click();
    await page.getByLabel(/название|title/i).fill("Buy milk");
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page.getByText("Buy milk")).toBeVisible();
    await page.getByRole("checkbox", { name: "Buy milk" }).check();
    await page.getByRole("checkbox", { name: "Buy milk" }).uncheck();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Buy milk" })).not.toBeChecked();
    await page.getByRole("button", { name: /удалить|delete/i }).click();
    await expect(page.getByText("Buy milk")).toHaveCount(0);

    const laterToday = new Date();
    laterToday.setHours(laterToday.getHours() + 2);
    if (laterToday.getDate() !== new Date().getDate()) {
      laterToday.setHours(23, 59, 0, 0);
    }
    const nowLocal = toDatetimeLocal(laterToday);
    await page.getByLabel(/название|title/i).fill("Due today task");
    await page.locator("#task-due").fill(nowLocal);
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page.getByText("Due today task")).toBeVisible();

    await page.getByRole("link", { name: /напоминания|reminders/i }).first().click();
    await expect(page.getByText(/доставляются в приложении|delivered in the app/i)).toBeVisible();
    await expect(page.getByText(/we will email|push notification|отправим письмо/i)).toHaveCount(0);
    await page.getByLabel(/название|title/i).fill("Call dentist");
    await page.locator("#reminder-at").fill(nowLocal);
    const tzConfirm = page.getByRole("checkbox", { name: /использовать|use /i });
    if (await tzConfirm.count()) {
      await tzConfirm.check();
    }
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page.getByText("Call dentist")).toBeVisible();
    await expect(page.getByText(/^напоминание сохранено\.|^reminder saved\.$/i)).toBeVisible();

    await page.goto("/work");
    await expect(page.getByText("Due today task")).toBeVisible();
    await expect(page.getByText("Call dentist")).toBeVisible();
  });

  test("manages checklist and plain lists", async ({ page, request }) => {
    test.setTimeout(60_000);
    const email = uniqueEmail("e2e-work-lists");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);

    await page.goto("/work/lists");
    await page.locator("#list-title").fill("Groceries");
    await page.locator("#list-type").selectOption("CHECKLIST");
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page).toHaveURL(/\/work\/lists\/.+/);
    await page.locator("#list-item").fill("Milk");
    await page.getByRole("button", { name: /добавить пункт|add item/i }).click();
    await expect(page.getByText("Milk")).toBeVisible();
    await expect(page.locator("#list-item")).toHaveValue("");
    await page.locator("#list-item").fill("Eggs");
    await page.getByRole("button", { name: /добавить пункт|add item/i }).click();
    await expect(page.getByText("Eggs")).toBeVisible();
    await page.getByRole("button", { name: /ниже|move down/i }).first().click();
    const rows = page.locator("ul li");
    await expect(rows.nth(0)).toContainText("Eggs");
    await expect(rows.nth(1)).toContainText("Milk");
    const milk = page.getByRole("checkbox", { name: "Milk" });
    await milk.click();
    await expect(milk).toBeChecked();

    await page.goto("/work/lists");
    await page.locator("#list-title").fill("Reading");
    await page.locator("#list-type").selectOption("PLAIN");
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page).toHaveURL(/\/work\/lists\/.+/);
    await page.locator("#list-item").fill("Chapter 1");
    await page.getByRole("button", { name: /добавить пункт|add item/i }).click();
    await expect(page.getByText("Chapter 1")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("creates, edits, pins, archives and searches notes", async ({ page, request }) => {
    test.setTimeout(60_000);
    const email = uniqueEmail("e2e-work-notes");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);

    await page.goto("/work/notes");
    await page.getByLabel(/название|title/i).fill("Project ideas");
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page).toHaveURL(/\/work\/notes\/.+/);
    await expect(page.locator("#note-content")).toBeVisible();
    await page.locator("#note-content").fill("plain markdown text");
    await page.getByRole("button", { name: /сохранить|save/i }).click();
    await page.getByRole("button", { name: /закрепить|pin/i }).click();
    await page.getByRole("button", { name: /в архив|archive/i }).click();

    await page.goto("/work/notes");
    await page.getByRole("button", { name: /показать архив|show archived/i }).click();
    await page.getByPlaceholder(/поиск|search/i).fill("plain markdown");
    await expect(page.getByRole("link", { name: "Project ideas" })).toBeVisible();
  });

  test("reschedules a reminder through the shared dialog", async ({ page, request }) => {
    const email = uniqueEmail("e2e-work-reschedule");
    await signUp(page, { name: "Ada", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);

    const first = new Date();
    first.setHours(first.getHours() + 1);
    const firstAt = toDatetimeLocal(first);
    const later = new Date();
    later.setHours(later.getHours() + 3);
    const laterAt = toDatetimeLocal(later);

    await page.goto("/work/reminders");
    await page.getByLabel(/название|title/i).fill("Call dentist");
    await page.locator("#reminder-at").fill(firstAt);
    const tzConfirm = page.getByRole("checkbox", { name: /использовать|use /i });
    if (await tzConfirm.count()) {
      await tzConfirm.check();
    }
    await page.getByRole("button", { name: /создать|create/i }).click();
    await expect(page.getByText("Call dentist")).toBeVisible();
    await expect(page.getByText(/^напоминание сохранено\.|^reminder saved\.$/i)).toBeVisible();
    await expect(page.getByText(/часовой пояс:|timezone:/i)).toBeVisible();

    await page.getByRole("button", { name: /перенести|reschedule/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.locator("#reminder-reschedule-at").fill(laterAt);
    await page.getByRole("button", { name: /применить|apply/i }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Call dentist")).toBeVisible();
    await page.getByRole("button", { name: /перенести|reschedule/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#reminder-reschedule-at")).toHaveValue(laterAt);
    await expect(page.getByRole("dialog").getByText(/часовой пояс:|timezone:/i)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: /^(отмена|cancel)$/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: /перенести|reschedule/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertNoDocumentOverflow(page);
    await expect(page.getByRole("button", { name: /применить|apply/i })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByRole("button", { name: /отменить напоминание|cancel reminder/i }).click();
    await expect(page.getByText("Call dentist")).toHaveCount(0);
  });
});

function toDatetimeLocal(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
