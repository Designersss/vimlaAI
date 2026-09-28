import { expect, test, type Page } from "@playwright/test";
import {
  apiBase,
  purchasePro,
  signUp,
  uniqueEmail,
  verifyEmail,
  webOrigin,
} from "./helpers";

const PROTECTED_PREFIX = "vimla-protected:v1:";
const REVOCATION_LATCH_KEY =
  "vimla:e2ee:current-device-revoked";

async function openDirectChat(
  page: Page,
  peerEmail: string,
): Promise<string> {
  await page.goto("/app");
  await page
    .getByRole("button", {
      name: /новый личный чат|new direct chat/i,
    })
    .click();
  await page
    .getByLabel(/email участника|participant email/i)
    .fill(peerEmail);
  await page
    .getByRole("button", {
      name: /начать чат|start chat/i,
    })
    .click();
  await expect(
    page.getByTestId("direct-chat-shell"),
  ).toBeVisible({ timeout: 20_000 });
  return page.url();
}

async function localDatabases(
  page: Page,
): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name)
      .filter(
        (name): name is string =>
          typeof name === "string",
      ),
  );
}

async function localDeviceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(
      (resolve, reject) => {
        const request = indexedDB.open(
          "vimla-direct-e2ee",
        );
        request.onsuccess = () =>
          resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ??
              new Error("E2EE database open failed"),
          );
      },
    );
    try {
      return await new Promise<string>(
        (resolve, reject) => {
          const tx = db.transaction(
            "device",
            "readonly",
          );
          const request = tx
            .objectStore("device")
            .get("local");
          request.onsuccess = () => {
            const row = request.result as
              | {
                  deviceId?: unknown;
                }
              | undefined;
            if (typeof row?.deviceId !== "string") {
              reject(
                new Error(
                  "Local crypto device is missing",
                ),
              );
              return;
            }
            resolve(row.deviceId);
          };
          request.onerror = () =>
            reject(
              request.error ??
                new Error(
                  "Local crypto device read failed",
                ),
            );
        },
      );
    } finally {
      db.close();
    }
  });
}

test.describe("E2EE H02 storage regressions", () => {
  test("encrypts prefix-like plaintext and fails closed when protected plaintext is rebound to another AAD", async ({
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail(
      "h02-storage-alice",
    );
    const nikitaEmail = uniqueEmail(
      "h02-storage-nikita",
    );
    const aliceContext =
      await browser.newContext();
    const nikitaContext =
      await browser.newContext();
    const alicePage =
      await aliceContext.newPage();
    const nikitaPage =
      await nikitaContext.newPage();

    try {
      await signUp(alicePage, {
        name: "Alice",
        email: aliceEmail,
        password,
      });
      await verifyEmail(
        alicePage,
        request,
        aliceEmail,
      );
      await purchasePro(alicePage);

      await signUp(nikitaPage, {
        name: "Nikita",
        email: nikitaEmail,
        password,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");

      const directUrl = await openDirectChat(
        alicePage,
        nikitaEmail,
      );
      const composer =
        alicePage.getByPlaceholder(
          /сообщение этому человеку|message this person/i,
        );
      const prefixLikePlaintext =
        `${PROTECTED_PREFIX}literal user text`;
      for (const text of [
        prefixLikePlaintext,
        "second AAD-bound local plaintext",
      ]) {
        await composer.fill(text);
        const responsePromise =
          alicePage.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              /\/v1\/direct-chats\/[^/]+\/messages$/.test(
                new URL(response.url()).pathname,
              ),
            { timeout: 20_000 },
          );
        await alicePage
          .getByTestId("chat-composer-send")
          .click();
        const response = await responsePromise;
        expect(response.ok()).toBe(true);
        await expect(
          alicePage
            .getByTestId("direct-message-human")
            .filter({ hasText: text }),
        ).toBeVisible({ timeout: 20_000 });
      }

      await alicePage.reload();
      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({
            hasText: prefixLikePlaintext,
          }),
      ).toBeVisible({ timeout: 20_000 });

      const stored = await alicePage.evaluate(
        async () => {
          const db =
            await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open(
                  "vimla-direct-e2ee",
                );
                request.onsuccess = () =>
                  resolve(request.result);
                request.onerror = () =>
                  reject(request.error);
              },
            );
          try {
            return await new Promise<
              Array<{
                messageId: string;
                text: string;
                protectionVersion?: number;
              }>
            >((resolve, reject) => {
              const tx = db.transaction(
                "plaintexts",
                "readonly",
              );
              const request = tx
                .objectStore("plaintexts")
                .getAll();
              request.onsuccess = () =>
                resolve(request.result);
              request.onerror = () =>
                reject(request.error);
            });
          } finally {
            db.close();
          }
        },
      );
      expect(stored.length).toBeGreaterThanOrEqual(2);
      expect(
        stored.every(
          (row) =>
            row.protectionVersion === 1 &&
            row.text.startsWith(PROTECTED_PREFIX),
        ),
      ).toBe(true);
      expect(
        stored.some(
          (row) => row.text === prefixLikePlaintext,
        ),
      ).toBe(false);

      await alicePage.evaluate(async () => {
        const db =
          await new Promise<IDBDatabase>(
            (resolve, reject) => {
              const request = indexedDB.open(
                "vimla-direct-e2ee",
              );
              request.onsuccess = () =>
                resolve(request.result);
              request.onerror = () =>
                reject(request.error);
            },
          );
        try {
          await new Promise<void>(
            (resolve, reject) => {
              const tx = db.transaction(
                "plaintexts",
                "readwrite",
              );
              const store =
                tx.objectStore("plaintexts");
              const request = store.getAll();
              request.onsuccess = () => {
                const rows = request.result as Array<{
                  messageId: string;
                  text: string;
                }>;
                const first = rows[0];
                const second = rows[1];
                if (!first || !second) {
                  tx.abort();
                  return;
                }
                store.put(
                  {
                    ...first,
                    text: second.text,
                  },
                  first.messageId,
                );
              };
              request.onerror = () =>
                reject(request.error);
              tx.oncomplete = () => resolve();
              tx.onabort = () =>
                reject(
                  tx.error ??
                    new Error(
                      "AAD tamper transaction aborted",
                    ),
                );
            },
          );
        } finally {
          db.close();
        }
      });

      await alicePage.goto(directUrl);
      await expect(
        alicePage.getByRole("button", {
          name: /повторить|retry/i,
        }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        alicePage.getByTestId("direct-chat-shell"),
      ).toHaveCount(0);
    } finally {
      await aliceContext.close();
      await nikitaContext.close();
    }
  });

  test("migrates legacy raw plaintext and pending rows through the protected schema", async ({
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail(
      "h02-legacy-alice",
    );
    const nikitaEmail = uniqueEmail(
      "h02-legacy-nikita",
    );
    const aliceContext =
      await browser.newContext();
    const nikitaContext =
      await browser.newContext();
    const alicePage =
      await aliceContext.newPage();
    const nikitaPage =
      await nikitaContext.newPage();

    try {
      await signUp(alicePage, {
        name: "Alice",
        email: aliceEmail,
        password,
      });
      await verifyEmail(
        alicePage,
        request,
        aliceEmail,
      );
      await purchasePro(alicePage);
      await signUp(nikitaPage, {
        name: "Nikita",
        email: nikitaEmail,
        password,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");

      await openDirectChat(alicePage, nikitaEmail);
      const composer =
        alicePage.getByPlaceholder(
          /сообщение этому человеку|message this person/i,
        );
      const legacyCacheText =
        `${PROTECTED_PREFIX}legacy raw cache`;
      const sentResponse = alicePage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/v1\/direct-chats\/[^/]+\/messages$/.test(
            new URL(response.url()).pathname,
          ) &&
          response.ok(),
      );
      await composer.fill(legacyCacheText);
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      const sent = (await (
        await sentResponse
      ).json()) as { id: string };

      await alicePage.evaluate(
        async ({ messageId, plaintext }) => {
          const db =
            await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open(
                  "vimla-direct-e2ee",
                );
                request.onsuccess = () =>
                  resolve(request.result);
                request.onerror = () =>
                  reject(request.error);
              },
            );
          try {
            await new Promise<void>(
              (resolve, reject) => {
                const tx = db.transaction(
                  "plaintexts",
                  "readwrite",
                );
                const store =
                  tx.objectStore("plaintexts");
                const request =
                  store.get(messageId);
                request.onsuccess = () => {
                  const row = request.result;
                  if (!row) {
                    tx.abort();
                    return;
                  }
                  store.put(
                    {
                      ...row,
                      protectionVersion: 0,
                      text: plaintext,
                    },
                    messageId,
                  );
                };
                request.onerror = () =>
                  reject(request.error);
                tx.oncomplete = () => resolve();
                tx.onabort = () =>
                  reject(
                    tx.error ??
                      new Error(
                        "Legacy plaintext seed aborted",
                      ),
                  );
              },
            );
          } finally {
            db.close();
          }
        },
        {
          messageId: sent.id,
          plaintext: legacyCacheText,
        },
      );

      await alicePage.reload();
      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({ hasText: legacyCacheText }),
      ).toBeVisible({ timeout: 20_000 });

      const migratedCache =
        await alicePage.evaluate(
          async (messageId) => {
            const db =
              await new Promise<IDBDatabase>(
                (resolve, reject) => {
                  const request = indexedDB.open(
                    "vimla-direct-e2ee",
                  );
                  request.onsuccess = () =>
                    resolve(request.result);
                  request.onerror = () =>
                    reject(request.error);
                },
              );
            try {
              return await new Promise<{
                protectionVersion?: number;
                text: string;
              }>((resolve, reject) => {
                const tx = db.transaction(
                  "plaintexts",
                  "readonly",
                );
                const request = tx
                  .objectStore("plaintexts")
                  .get(messageId);
                request.onsuccess = () =>
                  resolve(request.result);
                request.onerror = () =>
                  reject(request.error);
              });
            } finally {
              db.close();
            }
          },
          sent.id,
        );
      expect(
        migratedCache.protectionVersion,
      ).toBe(1);
      expect(migratedCache.text).not.toBe(
        legacyCacheText,
      );
      expect(
        migratedCache.text.startsWith(
          PROTECTED_PREFIX,
        ),
      ).toBe(true);

      let blockedPending = true;
      await alicePage.route(
        "**/v1/direct-chats/*/messages",
        async (route) => {
          if (
            blockedPending &&
            route.request().method() === "POST"
          ) {
            blockedPending = false;
            await route.abort("failed");
            return;
          }
          await route.continue();
        },
      );
      const legacyPendingText =
        `${PROTECTED_PREFIX}legacy raw pending`;
      await composer.fill(legacyPendingText);
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await expect.poll(() => blockedPending).toBe(false);

      await alicePage.evaluate(
        async (plaintext) => {
          const db =
            await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open(
                  "vimla-direct-e2ee",
                );
                request.onsuccess = () =>
                  resolve(request.result);
                request.onerror = () =>
                  reject(request.error);
              },
            );
          try {
            await new Promise<void>(
              (resolve, reject) => {
                const tx = db.transaction(
                  "pendingSends",
                  "readwrite",
                );
                const store =
                  tx.objectStore("pendingSends");
                const request = store.getAll();
                request.onsuccess = () => {
                  const row = (
                    request.result as Array<{
                      clientMessageId: string;
                      committedMessageId?: string;
                    }>
                  ).find(
                    (candidate) =>
                      !candidate.committedMessageId,
                  );
                  if (!row) {
                    tx.abort();
                    return;
                  }
                  store.put(
                    {
                      ...row,
                      protectionVersion: 0,
                      plaintext,
                    },
                    row.clientMessageId,
                  );
                };
                request.onerror = () =>
                  reject(request.error);
                tx.oncomplete = () => resolve();
                tx.onabort = () =>
                  reject(
                    tx.error ??
                      new Error(
                        "Legacy pending seed aborted",
                      ),
                  );
              },
            );
          } finally {
            db.close();
          }
        },
        legacyPendingText,
      );
      await alicePage.unroute(
        "**/v1/direct-chats/*/messages",
      );
      await alicePage.reload();
      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({ hasText: legacyPendingText }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await aliceContext.close();
      await nikitaContext.close();
    }
  });

  test("shares authoritative revocation across tabs and never silently re-enrolls", async ({
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail(
      "h02-tabs-alice",
    );
    const nikitaEmail = uniqueEmail(
      "h02-tabs-nikita",
    );
    const aliceContext =
      await browser.newContext();
    const nikitaContext =
      await browser.newContext();
    const alicePage =
      await aliceContext.newPage();
    const nikitaPage =
      await nikitaContext.newPage();

    try {
      await signUp(alicePage, {
        name: "Alice",
        email: aliceEmail,
        password,
      });
      await verifyEmail(
        alicePage,
        request,
        aliceEmail,
      );
      await purchasePro(alicePage);

      await signUp(nikitaPage, {
        name: "Nikita",
        email: nikitaEmail,
        password,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");

      const directUrl = await openDirectChat(
        alicePage,
        nikitaEmail,
      );
      const secondPage =
        await aliceContext.newPage();
      await secondPage.goto(directUrl);
      await expect(
        secondPage.getByTestId("direct-chat-shell"),
      ).toBeVisible({ timeout: 20_000 });

      const deviceId =
        await localDeviceId(alicePage);
      const revoke = await alicePage.request.post(
        `${apiBase}/v1/direct-chats/devices/${encodeURIComponent(
          deviceId,
        )}/revoke`,
        {
          headers: { origin: webOrigin },
        },
      );
      expect(revoke.ok()).toBe(true);

      const composer =
        alicePage.getByPlaceholder(
          /сообщение этому человеку|message this person/i,
        );
      await composer.fill(
        "revoked device send must wipe local state",
      );
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await expect
        .poll(async () => {
          const names =
            await localDatabases(alicePage);
          return (
            names.includes("vimla-direct-e2ee") ||
            names.includes("vimla-e2ee-keyring")
          );
        })
        .toBe(false);
      expect(
        await secondPage.evaluate(
          (key) => localStorage.getItem(key),
          REVOCATION_LATCH_KEY,
        ),
      ).toBe("1");

      let registrations = 0;
      secondPage.on("request", (outgoing) => {
        if (
          outgoing.method() === "POST" &&
          outgoing.url() ===
            `${apiBase}/v1/direct-chats/devices`
        ) {
          registrations += 1;
        }
      });
      await secondPage.reload();
      await expect(
        secondPage
          .getByRole("region", {
            name: /^(разговор|conversation)$/i,
          })
          .getByRole("button", {
            name: /повторить|retry/i,
          }),
      ).toBeVisible({ timeout: 20_000 });
      expect(
        await localDatabases(secondPage),
      ).not.toContain("vimla-direct-e2ee");
      expect(
        await localDatabases(secondPage),
      ).not.toContain("vimla-e2ee-keyring");
      expect(registrations).toBe(0);

      const devices = await alicePage.request.get(
        `${apiBase}/v1/direct-chats/devices`,
      );
      expect(devices.ok()).toBe(true);
      const payload = (await devices.json()) as {
        items: Array<{ revoked: boolean }>;
      };
      expect(
        payload.items.filter(
          (item) => !item.revoked,
        ),
      ).toHaveLength(0);
    } finally {
      await aliceContext.close();
      await nikitaContext.close();
    }
  });
});
