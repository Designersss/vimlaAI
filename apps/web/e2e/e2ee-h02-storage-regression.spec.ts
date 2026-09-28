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
        await alicePage
          .getByTestId("chat-composer-send")
          .click();
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

      await alicePage.reload();
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
        secondPage.getByRole("button", {
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
