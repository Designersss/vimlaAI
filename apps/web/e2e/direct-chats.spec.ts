import { expect, test, type Page } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("Secure Direct Chats", () => {
  test("two users receive E2EE user and @Vimla messages in realtime", async ({ browser, request }) => {
    test.setTimeout(240_000);
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

    let abortFirstEncryptedSend = true;
    await alicePage.route("**/v1/direct-chats/*/messages", async (route) => {
      if (
        abortFirstEncryptedSend &&
        route.request().method() === "POST"
      ) {
        await route.fetch();
        abortFirstEncryptedSend = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await composer.fill("first contact interrupted after server commit");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect.poll(() => abortFirstEncryptedSend).toBe(false);
    await alicePage.unroute("**/v1/direct-chats/*/messages");

    await alicePage.reload();
    await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({ hasText: "first contact interrupted after server commit" }),
    ).toHaveCount(1);

    await composer.fill("hello from alice");
    await expect(
      alicePage.getByTestId("chat-composer-send"),
    ).toBeEnabled();
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    for (let index = 0; index < 31; index += 1) {
      const text = `offline burst ${index}`;
      await composer.fill(text);
      await expect(
        alicePage.getByTestId("chat-composer-send"),
      ).toBeEnabled();
      await alicePage.getByTestId("chat-composer-send").click();
      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({ hasText: text }),
      ).toBeVisible({ timeout: 20_000 });
    }

    await nikitaPage.goto("/app");
    await expect(nikitaPage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await nikitaPage.getByRole("radio", { name: /личные|direct/i }).click();
    await expect(nikitaPage.getByTestId("direct-conversation-row")).toBeVisible({ timeout: 20_000 });
    await nikitaPage.getByTestId("direct-conversation-row").click();
    await expect(nikitaPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
    await expect(
      nikitaPage
        .getByTestId("direct-message-human")
        .filter({ hasText: "offline burst 30" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      nikitaPage.getByTestId("direct-message-undecryptable"),
    ).toHaveCount(0);
    await nikitaPage
      .getByTestId("direct-chat-load-older")
      .click();
    await expect(
      nikitaPage
        .getByTestId("direct-message-human")
        .filter({ hasText: "first contact interrupted after server commit" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      nikitaPage
        .getByTestId("direct-message-human")
        .filter({ hasText: "hello from alice" }),
    ).toBeVisible({ timeout: 20_000 });

    await composer.fill("live from alice");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(nikitaPage.getByTestId("direct-message-human").filter({ hasText: "live from alice" })).toBeVisible({
      timeout: 20_000,
    });

    let abortBeforeServer = true;
    await alicePage.route(
      "**/v1/direct-chats/*/messages",
      async (route) => {
        if (
          abortBeforeServer &&
          route.request().method() === "POST"
        ) {
          abortBeforeServer = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    await composer.fill("pending before peer device change");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect.poll(() => abortBeforeServer).toBe(false);
    await alicePage.unroute(
      "**/v1/direct-chats/*/messages",
    );

    const nikitaSecondContext = await browser.newContext({
      storageState: await nikitaContext.storageState(),
    });
    const nikitaSecondPage =
      await nikitaSecondContext.newPage();
    await nikitaSecondPage.goto(directUrl);
    await expect(
      nikitaSecondPage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    const nikitaSecondDeviceId =
      await readLocalDeviceId(nikitaSecondPage);
    const nikitaFirstDeviceId =
      await readLocalDeviceId(nikitaPage);
    expect(nikitaSecondDeviceId).not.toBe(
      nikitaFirstDeviceId,
    );

    const aliceRecoveryPage =
      await aliceContext.newPage();
    await disableWebLocks(aliceRecoveryPage);
    await Promise.all([
      alicePage.reload(),
      aliceRecoveryPage.goto(directUrl),
    ]);
    for (const page of [
      alicePage,
      aliceRecoveryPage,
    ]) {
      await expect(
        page.getByTestId("direct-chat-shell"),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page
          .getByTestId("direct-message-human")
          .filter({
            hasText: "pending before peer device change",
          }),
      ).toHaveCount(1);
    }
    const aliceRecoveryDeviceId =
      await readLocalDeviceId(aliceRecoveryPage);
    expect(aliceRecoveryDeviceId).toBe(
      await readLocalDeviceId(alicePage),
    );
    expect(
      await aliceRecoveryPage.evaluate(
        () => navigator.locks === undefined,
      ),
    ).toBe(true);
    await aliceRecoveryPage.close();

    for (const page of [
      nikitaPage,
      nikitaSecondPage,
    ]) {
      await expect(
        page
          .getByTestId("direct-message-human")
          .filter({
            hasText: "pending before peer device change",
          }),
      ).toBeVisible({ timeout: 20_000 });
    }

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
    expect(
      await aliceFallbackPage.evaluate(
        () => navigator.locks === undefined,
      ),
    ).toBe(true);
    expect(
      await nikitaFallbackPage.evaluate(
        () => navigator.locks === undefined,
      ),
    ).toBe(true);

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
    const heldWebLockKey = [
      "vimla-ratchet",
      directConversationId(directUrl),
      aliceLocalDeviceId,
      peerDeviceId,
    ].join(":");
    await holdWebLock(alicePage, heldWebLockKey);
    try {
      await composer.fill("held web lock falls back to durable lease");
      await alicePage.getByTestId("chat-composer-send").click();
      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({
            hasText: "held web lock falls back to durable lease",
          }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await releaseHeldWebLock(alicePage);
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
    const stressCount = 4;
    await Promise.all([
      (async () => {
        for (let index = 0; index < stressCount; index += 1) {
          const text = `parallel web-lock ${index}`;
          await primaryComposer.fill(text);
          await expect(
            alicePage.getByTestId("chat-composer-send"),
          ).toBeEnabled();
          await alicePage.getByTestId("chat-composer-send").click();
          await expect(
            alicePage
              .getByTestId("direct-message-human")
              .filter({ hasText: text }),
          ).toBeVisible({ timeout: 20_000 });
        }
      })(),
      (async () => {
        for (let index = 0; index < stressCount; index += 1) {
          const text = `parallel fallback ${index}`;
          await fallbackComposer.fill(text);
          await expect(
            aliceFallbackPage.getByTestId("chat-composer-send"),
          ).toBeEnabled();
          await aliceFallbackPage.getByTestId("chat-composer-send").click();
          await expect(
            aliceFallbackPage
              .getByTestId("direct-message-human")
              .filter({ hasText: text }),
          ).toBeVisible({ timeout: 20_000 });
        }
      })(),
    ]);

    for (const page of [nikitaPage, nikitaFallbackPage]) {
      for (const prefix of ["parallel web-lock", "parallel fallback"]) {
        for (let index = 0; index < stressCount; index += 1) {
          await expect(
            page
              .getByTestId("direct-message-human")
              .filter({ hasText: `${prefix} ${index}` }),
          ).toBeVisible({ timeout: 20_000 });
        }
      }
      await expect(
        page.getByTestId("direct-message-undecryptable"),
      ).toHaveCount(0);
    }
    const senderCopies = await alicePage.request.get(
      `${apiBase}/v1/direct-chats/${directConversationId(
        directUrl,
      )}/messages?deviceId=${encodeURIComponent(
        aliceLocalDeviceId,
      )}&limit=30`,
    );
    expect(senderCopies.ok()).toBe(true);
    const senderCopyPayload = (await senderCopies.json()) as {
      items: Array<{
        envelope: { messageNumber: number } | null;
      }>;
    };
    const parallelMessageNumbers = senderCopyPayload.items
      .slice(0, stressCount * 2)
      .map((message) => message.envelope?.messageNumber);
    expect(parallelMessageNumbers).toHaveLength(stressCount * 2);
    expect(parallelMessageNumbers.every(
      (messageNumber) => typeof messageNumber === "number",
    )).toBe(true);
    expect(new Set(parallelMessageNumbers).size).toBe(
      stressCount * 2,
    );

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
        await expect(aliceList).toBeHidden();
        await expect(
          alicePage.getByTestId("direct-chat-shell"),
        ).toBeVisible();
      } else {
        await expect(aliceList).toBeVisible();
      }
    }

    const coldContext = await browser.newContext({
      storageState: await aliceContext.storageState(),
    });
    const coldPageA = await coldContext.newPage();
    const coldPageB = await coldContext.newPage();
    await disableWebLocks(coldPageA);
    await disableWebLocks(coldPageB);
    let registrations = 0;
    for (const page of [coldPageA, coldPageB]) {
      page.on("request", (outgoing) => {
        if (
          outgoing.method() === "POST" &&
          outgoing.url() === `${apiBase}/v1/direct-chats/devices`
        ) {
          registrations += 1;
        }
      });
    }
    await Promise.all([
      coldPageA.goto(directUrl),
      coldPageB.goto(directUrl),
    ]);
    await expect(coldPageA.getByTestId("direct-chat-shell")).toBeVisible();
    await expect(coldPageB.getByTestId("direct-chat-shell")).toBeVisible();
    const [coldDeviceA, coldDeviceB] = await Promise.all([
      readLocalDeviceId(coldPageA),
      readLocalDeviceId(coldPageB),
    ]);
    expect(coldDeviceA).toBe(coldDeviceB);
    expect(registrations).toBe(1);
    await coldContext.close();

    await nikitaSecondContext.close();
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

async function holdWebLock(
  page: Page,
  key: string,
): Promise<void> {
  await page.evaluate((lockKey) => {
    const state = globalThis as typeof globalThis & {
      __vimlaHeldWebLock?: boolean;
      __vimlaReleaseWebLock?: () => void;
    };
    let release: (() => void) | null = null;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.__vimlaReleaseWebLock = () => release?.();
    void navigator.locks.request(
      lockKey,
      { mode: "exclusive" },
      async () => {
        state.__vimlaHeldWebLock = true;
        await blocker;
        state.__vimlaHeldWebLock = false;
      },
    );
  }, key);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (
              globalThis as typeof globalThis & {
                __vimlaHeldWebLock?: boolean;
              }
            ).__vimlaHeldWebLock,
          ),
      ),
    )
    .toBe(true);
}

async function releaseHeldWebLock(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __vimlaReleaseWebLock?: () => void;
      }
    ).__vimlaReleaseWebLock?.();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (
              globalThis as typeof globalThis & {
                __vimlaHeldWebLock?: boolean;
              }
            ).__vimlaHeldWebLock,
          ),
      ),
    )
    .toBe(false);
}

async function readLocalDeviceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
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

async function rewriteRatchetAsLegacy(
  page: Page,
  input: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
  },
): Promise<void> {
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("E2EE IndexedDB open failed"));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("ratchets", "readwrite");
        const store = tx.objectStore("ratchets");
        const scopedKey = [
          value.conversationId,
          value.localDeviceId,
          value.peerDeviceId,
        ].join(":");
        const legacyKey = `${value.conversationId}:${value.peerDeviceId}`;
        const request = store.get(scopedKey);
        request.onsuccess = () => {
          const current = request.result as
            | { state?: unknown }
            | undefined;
          if (!current || !current.state) {
            reject(new Error("Versioned ratchet fixture is missing"));
            tx.abort();
            return;
          }
          store.put(current.state, legacyKey);
          store.delete(scopedKey);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error("Legacy ratchet fixture failed"));
        tx.onabort = () =>
          reject(tx.error ?? new Error("Legacy ratchet fixture aborted"));
      });
    } finally {
      db.close();
    }
  }, input);
}

async function readRatchetRecordVersion(
  page: Page,
  input: {
    conversationId: string;
    localDeviceId: string;
    peerDeviceId: string;
  },
): Promise<{ schemaVersion: number; stateVersion: number }> {
  return page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("E2EE IndexedDB open failed"));
    });
    try {
      return await new Promise<{
        schemaVersion: number;
        stateVersion: number;
      }>((resolve, reject) => {
        const tx = db.transaction("ratchets", "readonly");
        const key = [
          value.conversationId,
          value.localDeviceId,
          value.peerDeviceId,
        ].join(":");
        const request = tx.objectStore("ratchets").get(key);
        request.onsuccess = () => {
          const current = request.result as
            | { schemaVersion?: unknown; stateVersion?: unknown }
            | undefined;
          if (
            !current ||
            typeof current.schemaVersion !== "number" ||
            typeof current.stateVersion !== "number"
          ) {
            reject(new Error("Versioned ratchet record is missing"));
            return;
          }
          resolve({
            schemaVersion: current.schemaVersion,
            stateVersion: current.stateVersion,
          });
        };
        request.onerror = () =>
          reject(request.error ?? new Error("Ratchet version read failed"));
      });
    } finally {
      db.close();
    }
  }, input);
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
      const request = indexedDB.open("vimla-direct-e2ee", 4);
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

