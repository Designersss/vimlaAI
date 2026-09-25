import { expect, test, type Page } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("Secure Direct Chats", () => {
  test("two users receive E2EE user and @Vimla messages in realtime", async ({ browser, request }) => {
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

    const directUrl = alicePage.url();
    const aliceList = alicePage.getByRole("region", { name: /список разговоров|conversation list/i, includeHidden: true });
    await expect(aliceList).toBeVisible();
    await expect(aliceList.getByTestId("direct-conversation-row")).toHaveAttribute("aria-current", "page");
    const persistentList = await aliceList.elementHandle();

    const composer = alicePage.getByPlaceholder(/сообщение этому человеку|message this person/i);
    await composer.fill("@");
    const mentionPicker = alicePage.getByTestId("mention-picker");
    await expect(mentionPicker).toBeVisible();
    await expect(mentionPicker.getByRole("option", { name: /Nikita/i })).toBeVisible();
    await expect(mentionPicker.getByRole("option", { name: /@vimla/i })).toBeVisible();
    await expect(mentionPicker.getByRole("option", { name: /@auto/i })).toBeVisible();
    await mentionPicker.getByRole("option", { name: /Nikita/i }).click();
    await expect(composer).toHaveValue(/^@nikita_[a-z0-9]+ $/i);
    await expect(composer).toBeFocused();

    await composer.fill("@a");
    await expect(mentionPicker).toBeVisible();
    await expect(mentionPicker.getByRole("option", { name: /@auto/i })).toBeVisible();

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

    await composer.fill("live from alice");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(nikitaPage.getByTestId("direct-message-human").filter({ hasText: "live from alice" })).toBeVisible({
      timeout: 20_000,
    });

    const aliceFallbackPage = await aliceContext.newPage();
    const nikitaFallbackPage = await nikitaContext.newPage();
    await disableWebLocks(aliceFallbackPage);
    await disableWebLocks(nikitaFallbackPage);
    await Promise.all([
      aliceFallbackPage.goto(directUrl),
      nikitaFallbackPage.goto(directUrl),
    ]);
    await expect(aliceFallbackPage.getByTestId("direct-chat-shell")).toBeVisible({
      timeout: 20_000,
    });
    await expect(nikitaFallbackPage.getByTestId("direct-chat-shell")).toBeVisible({
      timeout: 20_000,
    });

    const aliceLocalDeviceId = await readLocalDeviceId(aliceFallbackPage);
    const detailResponse = await alicePage.request.get(
      `${apiBase}/v1/direct-chats/${directConversationId(directUrl)}`,
    );
    expect(detailResponse.ok()).toBe(true);
    const detailPayload = (await detailResponse.json()) as {
      devices: Array<{ id: string }>;
    };
    const peerDeviceId = detailPayload.devices.find(
      (device) => device.id !== aliceLocalDeviceId,
    )?.id;
    expect(peerDeviceId).toBeTruthy();
    if (!peerDeviceId) {
      throw new Error("Direct Chat peer device is missing");
    }
    await seedExpiredRatchetLease(aliceFallbackPage, {
      conversationId: directConversationId(directUrl),
      localDeviceId: aliceLocalDeviceId,
      peerDeviceId,
    });

    const primaryComposer = alicePage.getByPlaceholder(
      /сообщение этому человеку|message this person/i,
    );
    const fallbackComposer = aliceFallbackPage.getByPlaceholder(
      /сообщение этому человеку|message this person/i,
    );
    await primaryComposer.fill("parallel ratchet one");
    await fallbackComposer.fill("parallel ratchet two");
    await Promise.all([
      alicePage.getByTestId("chat-composer-send").click(),
      aliceFallbackPage.getByTestId("chat-composer-send").click(),
    ]);

    for (const page of [nikitaPage, nikitaFallbackPage]) {
      await expect(
        page
          .getByTestId("direct-message-human")
          .filter({ hasText: "parallel ratchet one" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page
          .getByTestId("direct-message-human")
          .filter({ hasText: "parallel ratchet two" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByTestId("direct-message-undecryptable"),
      ).toHaveCount(0);
    }
    await aliceFallbackPage.close();
    await nikitaFallbackPage.close();

    await expect(alicePage.getByTestId("direct-mention-vimla")).toHaveCount(0);
    await composer.fill("@vimla");
    await expect(alicePage.getByTestId("composer-mention-highlight")).toHaveText("@vimla", { timeout: 20_000 });
    await composer.fill("@vimla кто победил в гран-при 2026?");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });
    await expect(alicePage.getByTestId("direct-message-response")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-response")).toBeVisible({ timeout: 20_000 });

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
      if (viewport.width < 768) {
        await expect(aliceList).toBeHidden();
        await alicePage.getByRole("link", { name: /назад|back/i }).click();
        await expect(alicePage).toHaveURL("/app");
        await expect(aliceList).toBeVisible();
        await aliceList.getByTestId("direct-conversation-row").click();
        await expect(alicePage).toHaveURL(directUrl);
        await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible();
        expect(await persistentList?.evaluate((el) => el.isConnected)).toBe(true);
      } else {
        await expect(aliceList).toBeVisible();
      }
    }

    const coldContext = await browser.newContext({ storageState: await aliceContext.storageState() });
    const coldPage = await coldContext.newPage();
    let registrations = 0;
    coldPage.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url() === `${apiBase}/v1/direct-chats/devices`) registrations += 1;
    });
    await coldPage.goto(directUrl);
    await expect(coldPage.getByTestId("direct-chat-shell")).toBeVisible();
    await expect(coldPage.getByTestId("direct-conversation-row")).toBeVisible();
    expect(registrations).toBe(1);
    await coldContext.close();

    await aliceContext.close();
    await nikitaContext.close();
  });
});

function directConversationId(url: string): string {
  const id = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!id) {
    throw new Error("Direct Chat URL is missing a conversation id");
  }
  return id;
}

async function disableWebLocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
}

async function readLocalDeviceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("E2EE IndexedDB open failed"));
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const tx = db.transaction("device", "readonly");
        const request = tx.objectStore("device").get("local");
        request.onsuccess = () => {
          const value = request.result as { deviceId?: unknown } | undefined;
          if (!value || typeof value.deviceId !== "string") {
            reject(new Error("Local E2EE device is missing"));
            return;
          }
          resolve(value.deviceId);
        };
        request.onerror = () =>
          reject(request.error ?? new Error("Local E2EE device read failed"));
      });
    } finally {
      db.close();
    }
  });
}

async function seedExpiredRatchetLease(
  page: Page,
  input: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
  },
): Promise<void> {
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("E2EE IndexedDB open failed"));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("ratchetLocks", "readwrite");
        tx.objectStore("ratchetLocks").put(
          {
            owner: "simulated-crashed-tab",
            expiresAt: Date.now() - 1_000,
          },
          [
            "vimla-ratchet",
            value.conversationId,
            value.localDeviceId,
            value.peerDeviceId,
          ].join(":"),
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error("Ratchet lease seed failed"));
      });
    } finally {
      db.close();
    }
  }, input);
}

