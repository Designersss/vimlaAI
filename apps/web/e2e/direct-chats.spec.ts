import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("Secure Direct Chats", () => {
  test("clears only the authenticated account's E2EE state on logout", async ({ page, request }) => {
    const email = uniqueEmail("e2e-direct-logout");
    await signUp(page, { name: "Logout E2EE", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    const me = await page.request.get(`${apiBase}/v1/me`, { headers: { origin: webOrigin } });
    const accountId = String((await me.json()).id);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await seedForeignAccountRecord(page);
    expect(await sensitiveRecordCount(page, accountId)).toBeGreaterThan(0);

    await page.getByRole("button", { name: /выйти|sign out/i }).first().click();
    await expect(page).toHaveURL(/sign-in/);
    expect(await sensitiveRecordCount(page, accountId)).toBe(0);
    expect(await sensitiveRecordCount(page, "other-account")).toBe(1);
  });

  test("purges retained secrets and fails closed after local device revocation", async ({ page, request }) => {
    const email = uniqueEmail("e2e-direct-revoke");
    await signUp(page, { name: "Revoked E2EE", email, password: "correct-horse-battery" });
    await verifyEmail(page, request, email);
    await purchasePro(page);
    const me = await page.request.get(`${apiBase}/v1/me`, { headers: { origin: webOrigin } });
    const accountId = String((await me.json()).id);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    const deviceId = await localDeviceId(page, accountId);
    const revoked = await page.request.post(`${apiBase}/v1/direct-chats/devices/${deviceId}/revoke`, {
      headers: { origin: webOrigin, "content-type": "application/json" },
      data: {},
    });
    expect(revoked.ok()).toBeTruthy();

    await page.reload();
    await expect.poll(() => sensitiveRecordCount(page, accountId)).toBe(0);
    await expect(page.getByText(/не удалось загрузить рабочее пространство|could not load the workspace/i)).toBeVisible();
  });

  test("two users exchange E2EE messages and invoke @Vimla in-thread", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail("e2e-direct-alice");
    const nikitaEmail = uniqueEmail("e2e-direct-nikita");

    const aliceContext = await browser.newContext();
    const nikitaContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const nikitaPage = await nikitaContext.newPage();

    await signUp(alicePage, { name: "Alice", email: aliceEmail, password });
    await verifyEmail(alicePage, request, aliceEmail);
    await purchasePro(alicePage);
    await alicePage.request.patch(`${apiBase}/v1/me/preferences`, {
      data: { timezone: "Europe/Moscow" },
      headers: { origin: webOrigin, "content-type": "application/json" },
    });

    await signUp(nikitaPage, { name: "Nikita", email: nikitaEmail, password });
    await verifyEmail(nikitaPage, request, nikitaEmail);
    await purchasePro(nikitaPage);
    await nikitaPage.goto("/app");
    await expect(nikitaPage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();

    await alicePage.goto("/app");
    await expect(alicePage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await alicePage.getByRole("button", { name: /новый личный чат|new direct chat/i }).click();
    await alicePage.getByLabel(/email участника|participant email/i).fill(nikitaEmail);
    await alicePage.getByRole("button", { name: /начать чат|start chat/i }).click();
    await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });

    const composer = alicePage.getByPlaceholder(/сообщение этому человеку|message this person/i);
    await composer.fill("hello from alice");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    await nikitaPage.goto("/app");
    await expect(nikitaPage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await nikitaPage.getByRole("radio", { name: /личные|direct/i }).click();
    await expect(nikitaPage.getByTestId("direct-conversation-row")).toBeVisible({ timeout: 20_000 });
    await nikitaPage.getByTestId("direct-conversation-row").click();
    await expect(nikitaPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    const mentionButton = alicePage.getByTestId("direct-mention-vimla");
    await mentionButton.click();
    await expect(mentionButton).toHaveAttribute("aria-pressed", "true");
    await composer.fill("@Vimla, кто победил в гран-при 2026?");
    await expect(composer).toHaveValue("@Vimla, кто победил в гран-при 2026?");
    await expect(mentionButton).toHaveAttribute("aria-pressed", "true");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });
    await expect(alicePage.getByTestId("direct-message-response")).toBeVisible({ timeout: 20_000 });

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await alicePage.setViewportSize(viewport);
      await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible();
      await assertReachable(alicePage, alicePage.getByTestId("chat-composer-send"));
      await assertNoDocumentOverflow(alicePage);
    }

    await aliceContext.close();
    await nikitaContext.close();
  });
});

async function withE2eeDb<T>(page: import("@playwright/test").Page, operation: string, accountId: string): Promise<T> {
  return page.evaluate(async ({ operation, accountId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (operation === "seed") {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("device", "readwrite");
        tx.objectStore("device").put({ deviceId: "foreign" }, `${accountId}:local`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return undefined as T;
    }
    const stores = ["device", "ratchets", "plaintexts"];
    const values = await Promise.all(stores.map((storeName) => new Promise<Array<[IDBValidKey, unknown]>>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result.map((key) => [key, null]));
      request.onerror = () => reject(request.error);
    })));
    if (operation === "device") {
      const tx = db.transaction("device", "readonly");
      const request = tx.objectStore("device").get(`${accountId}:local`);
      const material = await new Promise<{ deviceId: string }>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as { deviceId: string });
        request.onerror = () => reject(request.error);
      });
      db.close();
      return material.deviceId as T;
    }
    db.close();
    return values.flat().filter(([key]) => String(key).startsWith(`${accountId}:`)).length as T;
  }, { operation, accountId });
}

async function sensitiveRecordCount(page: import("@playwright/test").Page, accountId: string): Promise<number> {
  return withE2eeDb<number>(page, "count", accountId);
}

async function localDeviceId(page: import("@playwright/test").Page, accountId: string): Promise<string> {
  return withE2eeDb<string>(page, "device", accountId);
}

async function seedForeignAccountRecord(page: import("@playwright/test").Page): Promise<void> {
  await withE2eeDb<void>(page, "seed", "other-account");
}
