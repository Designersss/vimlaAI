import { expect, test, type Page } from "@playwright/test";
import { conversationCreatedSchema } from "@vimla/contracts";
import { apiBase, webOrigin, signUp, uniqueEmail, verifyEmail } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

const master = (page: Page) => page.getByRole("region", { name: /список разговоров|conversation list/i, includeHidden: true });
const detail = (page: Page) => page.getByRole("region", { name: /^(разговор|conversation detail)$/i, includeHidden: true });
const composer = (page: Page) => page.getByPlaceholder(/сообщение для vimla|message vimla/i);

async function createChat(page: Page, title: string): Promise<string> {
  const response = await page.request.post(`${apiBase}/v1/conversations`, {
    headers: { origin: webOrigin }, data: { title },
  });
  expect(response.status()).toBe(201);
  return conversationCreatedSchema.parse(await response.json()).id;
}

async function watchPersistence(page: Page) {
  return page.evaluateHandle(() => {
    const shell = document.querySelector('[data-testid="consumer-shell"]');
    const list = document.querySelector('[data-detail-open] > div > section');
    const bell = document.querySelector('[data-testid="notification-bell"]');
    if (!shell || !list || !bell) throw new Error("Missing persistent layout");
    const state = { shell, list, bell, removed: false, observer: new MutationObserver(() => {}) };
    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if ([shell, list, bell].some((element) => node.contains(element))) state.removed = true;
        }
      }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
    return state;
  });
}

test("desktop preserves shell, list, search, filter, scroll and drafts while detail routes change", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = uniqueEmail("master-detail");
  await signUp(page, { name: "Layout", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
  const ids: string[] = [];
  for (let i = 0; i < 20; i += 1) ids.push(await createChat(page, `Layout ${String(i).padStart(2, "0")}`));
  await page.goto("/app");
  await expect(master(page)).toBeVisible();
  await master(page).getByRole("radio", { name: /^(ии|ai)$/i }).check();
  await master(page).getByRole("searchbox").fill("Layout");
  const first = master(page).getByRole("link", { name: "Layout 08", exact: true });
  await first.scrollIntoViewIfNeeded();
  const scroll = await master(page).evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  const persistence = await watchPersistence(page);
  await first.click();
  await expect(page).toHaveURL(`/app/${ids[8]}`);
  await expect(composer(page)).toBeVisible();
  await expect(master(page)).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "page");
  await composer(page).fill("Черновик A — draft A");
  await master(page).getByRole("link", { name: "Layout 09", exact: true }).click();
  await expect(page).toHaveURL(`/app/${ids[9]}`);
  await expect(composer(page)).toHaveValue("");
  await expect(master(page).getByRole("searchbox")).toHaveValue("Layout");
  await expect(master(page).getByRole("radio", { name: /^(ии|ai)$/i })).toBeChecked();
  expect(await master(page).evaluate((el) => el.scrollTop)).toBe(scroll);
  await first.click();
  await expect(composer(page)).toHaveValue("Черновик A — draft A");
  expect(await persistence.evaluate((s) => !s.removed && s.shell.isConnected && s.list.isConnected && s.bell.isConnected)).toBe(true);
  await persistence.evaluate((s) => s.observer.disconnect());
  await expect(detail(page).getByRole("link", { name: /назад|back/i })).toBeHidden();
  await assertNoDocumentOverflow(page);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: testInfo.outputPath("desktop-detail.png") });
  await testInfo.attach("desktop-detail", { path: testInfo.outputPath("desktop-detail.png"), contentType: "image/png" });
  await page.reload();
  await expect(page).toHaveURL(`/app/${ids[8]}`);
  await expect(composer(page)).toBeVisible();
  await expect(master(page)).toBeVisible();
});

test("mobile uses the same panes, deterministic back and browser history across the responsive matrix", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("mobile-detail");
  await signUp(page, { name: "Responsive", email, password: "correct-horse-battery" }, "en");
  await verifyEmail(page, request, email);
  const title = "Длинное название разговора — LongConversationTitleWithoutSpaces".repeat(2).slice(0, 120);
  const id = await createChat(page, title);
  for (const viewport of [
    { width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 },
    { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.width % 2 ? "light" : "dark" });
    await page.goto("/app");
    const list = master(page);
    await expect(list).toBeVisible();
    if (viewport.width < 768) await expect(detail(page)).toBeHidden();
    if (viewport.width === 390) {
      await list.getByRole("link", { name: title, exact: true }).waitFor({ state: "visible" });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.screenshot({ path: testInfo.outputPath("mobile-list.png") });
      await testInfo.attach("mobile-list", { path: testInfo.outputPath("mobile-list.png"), contentType: "image/png" });
    }
    await list.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(`/app/${id}`);
    await expect(composer(page)).toBeVisible();
    await expect(detail(page)).toBeVisible();
    await assertReachable(page, page.getByTestId("chat-composer-send"));
    await assertNoDocumentOverflow(page);
    if (viewport.width < 768) {
      await expect(list).toBeHidden();
      if (viewport.width === 390) {
        await page.screenshot({ path: testInfo.outputPath("mobile-detail.png") });
        await testInfo.attach("mobile-detail", { path: testInfo.outputPath("mobile-detail.png"), contentType: "image/png" });
      }
      await detail(page).getByRole("link", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL("/app");
      await expect(list).toBeVisible();
    } else {
      await expect(list).toBeVisible();
      await expect(detail(page).getByRole("link", { name: "Back", exact: true })).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/${id}`);
  await expect(composer(page)).toBeVisible();
  await detail(page).getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL("/app");
  await page.goBack();
  await expect(page).toHaveURL(`/app/${id}`);
  await expect(detail(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL("/app");
  await expect(master(page)).toBeVisible();
});

test("loading and failed detail stay scoped, and the consumer shell persists across other destinations", async ({ page, request }) => {
  const email = uniqueEmail("detail-failure");
  await signUp(page, { name: "Recovery", email, password: "correct-horse-battery" });
  await verifyEmail(page, request, email);
  const id = await createChat(page, "Recovery chat");
  await page.goto("/app");
  await expect(master(page).getByRole("link", { name: "Recovery chat" })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${apiBase}/v1/conversations/${id}`, async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { code: "internal_error" } } });
  });
  const persistence = await watchPersistence(page);
  await master(page).getByRole("link", { name: "Recovery chat" }).click();
  await expect(detail(page).getByRole("status")).toBeVisible();
  await expect(master(page)).toBeVisible();
  release();
  await expect(detail(page).getByRole("button", { name: /повторить|try again/i })).toBeVisible();
  expect(await persistence.evaluate((s) => !s.removed && s.list.isConnected)).toBe(true);
  await page.unroute(`${apiBase}/v1/conversations/${id}`);
  await detail(page).getByRole("button", { name: /повторить|try again/i }).click();
  await expect(composer(page)).toBeVisible();
  await persistence.evaluate((s) => s.observer.disconnect());
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const shell = await page.getByTestId("consumer-shell").elementHandle();
  for (const href of ["/work", "/projects", "/settings/account", "/app"]) {
    await page.locator(`nav a[href="${href}"]:visible`).first().click();
    await expect(page).toHaveURL(href);
    expect(await shell?.evaluate((el) => el.isConnected)).toBe(true);
    await expect(page.getByTestId("consumer-shell")).toHaveCount(1);
  }
  await page.goto("/settings");
  await expect(page).toHaveURL("/settings");
  await expect(page.getByTestId("settings-navigation-pane")).toBeVisible();
});
