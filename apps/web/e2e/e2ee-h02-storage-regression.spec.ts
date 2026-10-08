import { expect, test, type Page } from "@playwright/test";
import {
  apiBase,
  purchasePro,
  signUp,
  uniqueEmail,
  uniqueHandle,
  verifyEmail,
  waitForRegisteredDirectChatDevice,
  webOrigin,
} from "./helpers";

const PROTECTED_PREFIX = "vimla-protected:v1:";
const REVOCATION_LATCH_KEY =
  "vimla:e2ee:current-device-revoked";

async function openDirectChat(
  page: Page,
  peerHandle: string,
): Promise<string> {
  await page.goto("/app");
  await page
    .getByRole("button", {
      name: /новый личный чат|new direct chat/i,
    })
    .click();
  await page
    .getByPlaceholder("@handle")
    .fill(`@${peerHandle}`);
  const peerResult = page
    .getByTestId("people-search-results")
    .getByRole("button")
    .filter({ hasText: `@${peerHandle}` });
  await expect(peerResult).toHaveCount(1, {
    timeout: 20_000,
  });
  await peerResult.click();
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
    const nikitaHandle = uniqueHandle("h02storage");
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
        name: "Storage Peer",
        email: nikitaEmail,
        password,
        handle: nikitaHandle,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");
      await waitForRegisteredDirectChatDevice(nikitaPage);

      const directUrl = await openDirectChat(
        alicePage,
        nikitaHandle,
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

      const stored =
        await alicePage.evaluate(
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

      const downgradeTarget = stored[0];
      expect(downgradeTarget).toBeDefined();
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
            await new Promise<void>(
              (resolve, reject) => {
                const tx = db.transaction(
                  "plaintexts",
                  "readwrite",
                );
                const store =
                  tx.objectStore("plaintexts");
                const request = store.get(messageId);
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
                        "Protection downgrade transaction aborted",
                      ),
                  );
              },
            );
          } finally {
            db.close();
          }
        },
        downgradeTarget!.messageId,
      );
      await alicePage.goto(directUrl);
      await expect(
        alicePage
          .getByRole("region", {
            name: /разговор|conversation/i,
          })
          .getByRole("button", {
            name: /повторить|retry/i,
          }),
      ).toBeVisible({ timeout: 20_000 });

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
            await new Promise<void>(
              (resolve, reject) => {
                const tx = db.transaction(
                  "plaintexts",
                  "readwrite",
                );
                const store =
                  tx.objectStore("plaintexts");
                const request = store.get(messageId);
                request.onsuccess = () => {
                  const row = request.result;
                  if (!row) {
                    tx.abort();
                    return;
                  }
                  store.put(
                    {
                      ...row,
                      protectionVersion: 1,
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
                        "Protection downgrade restore aborted",
                      ),
                  );
              },
            );
          } finally {
            db.close();
          }
        },
        downgradeTarget!.messageId,
      );
      await alicePage.goto(directUrl);
      await expect(
        alicePage.getByTestId("direct-chat-shell"),
      ).toBeVisible({ timeout: 20_000 });

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

  test("scrubs plaintext-bearing legacy operator output ids while preserving parent-child linkage", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const password = "correct-horse-battery";
    const email = uniqueEmail(
      "h02-legacy-output-id",
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    const legacyOutputId = JSON.stringify([
      "response",
      "legacy secret response text",
      null,
    ]);

    try {
      await signUp(page, {
        name: "Legacy Output",
        email,
        password,
      });
      await verifyEmail(page, request, email);
      await purchasePro(page);
      await page.goto("/settings/security");

      await page.evaluate(
        async ({ oldOutputId }) => {
          await new Promise<void>(
            (resolve, reject) => {
              const request =
                indexedDB.deleteDatabase(
                  "vimla-direct-e2ee",
                );
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error);
              request.onblocked = () =>
                reject(
                  new Error(
                    "Legacy output-id reset was blocked",
                  ),
                );
            },
          );
          const db =
            await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open(
                  "vimla-direct-e2ee",
                  5,
                );
                request.onupgradeneeded = () => {
                  request.result.createObjectStore(
                    "pendingSends",
                  );
                };
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
                store.put(
                  {
                    conversationId:
                      "legacy-conversation",
                    clientMessageId:
                      "legacy-parent",
                    senderUserId: "legacy-user",
                    senderDeviceId:
                      "legacy-device",
                    kind: "OPERATOR_INVOKE",
                    envelopes: [],
                    mentions: [],
                    plaintext:
                      "legacy invoke plaintext",
                    createdAt:
                      "2026-01-01T00:00:00.000Z",
                    committedMessageId:
                      "legacy-message",
                    committedCreatedAt:
                      "2026-01-01T00:00:01.000Z",
                    operatorIntent: {
                      clientRequestId:
                        "legacy-request",
                      content:
                        "legacy command plaintext",
                      contextBundle: {
                        conversationId:
                          "legacy-conversation",
                        generatedAt:
                          "2026-01-01T00:00:00.000Z",
                        messages: [],
                      },
                      delivery: {
                        runId: "legacy-run",
                        runStatus: "SUCCEEDED",
                        runUpdatedAt:
                          "2026-01-01T00:00:01.000Z",
                        outputs: [
                          {
                            id: oldOutputId,
                            clientMessageId:
                              "legacy-child",
                            kind:
                              "OPERATOR_RESPONSE",
                            plaintext:
                              "legacy secret response text",
                            delivered: false,
                          },
                        ],
                      },
                    },
                  },
                  "legacy-parent",
                );
                store.put(
                  {
                    conversationId:
                      "legacy-conversation",
                    clientMessageId:
                      "legacy-child",
                    senderUserId: "legacy-user",
                    senderDeviceId:
                      "legacy-device",
                    kind: "OPERATOR_RESPONSE",
                    envelopes: [],
                    mentions: [],
                    plaintext:
                      "legacy secret response text",
                    createdAt:
                      "2026-01-01T00:00:02.000Z",
                    operatorOutput: {
                      parentClientMessageId:
                        "legacy-parent",
                      outputId: oldOutputId,
                    },
                  },
                  "legacy-child",
                );
                tx.oncomplete = () => resolve();
                tx.onerror = () =>
                  reject(tx.error);
                tx.onabort = () =>
                  reject(
                    tx.error ??
                      new Error(
                        "Legacy output-id seed aborted",
                      ),
                  );
              },
            );
          } finally {
            db.close();
          }
        },
        { oldOutputId: legacyOutputId },
      );

      await page.goto("/app");
      await expect(
        page.getByRole("heading", {
          name: /сообщения|messages/i,
        }),
      ).toBeVisible({ timeout: 20_000 });

      const migrated = await page.evaluate(
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
            return await new Promise<{
              parentId: string | null;
              childId: string | null;
              serialized: string;
            }>((resolve, reject) => {
              const tx = db.transaction(
                "pendingSends",
                "readonly",
              );
              const request = tx
                .objectStore("pendingSends")
                .getAll();
              request.onsuccess = () => {
                const rows =
                  request.result as Array<{
                    clientMessageId?: string;
                    operatorIntent?: {
                      delivery?: {
                        outputs?: Array<{
                          id?: string;
                        }>;
                      };
                    };
                    operatorOutput?: {
                      outputId?: string;
                    };
                  }>;
                const parent = rows.find(
                  (row) =>
                    row.clientMessageId ===
                    "legacy-parent",
                );
                const child = rows.find(
                  (row) =>
                    row.clientMessageId ===
                    "legacy-child",
                );
                resolve({
                  parentId:
                    parent?.operatorIntent?.delivery
                      ?.outputs?.[0]?.id ?? null,
                  childId:
                    child?.operatorOutput?.outputId ??
                    null,
                  serialized: JSON.stringify(rows),
                });
              };
              request.onerror = () =>
                reject(request.error);
            });
          } finally {
            db.close();
          }
        },
      );
      expect(migrated.parentId).toMatch(
        /^legacy-output:[0-9a-f-]+$/,
      );
      expect(migrated.childId).toBe(
        migrated.parentId,
      );
      expect(migrated.serialized).not.toContain(
        legacyOutputId,
      );
      expect(migrated.parentId).not.toContain(
        "legacy secret response text",
      );
    } finally {
      await context.close();
    }
  });

  test("re-protects unencrypted legacy local rows but rejects HUMAN content-ID forgery", async ({
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
    const nikitaHandle = uniqueHandle("h02legacy");
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
        name: "Legacy Storage Peer",
        email: nikitaEmail,
        password,
        handle: nikitaHandle,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");
      await waitForRegisteredDirectChatDevice(nikitaPage);

      await openDirectChat(alicePage, nikitaHandle);
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

      await expect
        .poll(
          () =>
            alicePage.evaluate(async (messageId) => {
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
                return await new Promise<boolean>(
                  (resolve, reject) => {
                    const tx = db.transaction(
                      "plaintexts",
                      "readonly",
                    );
                    const request = tx
                      .objectStore("plaintexts")
                      .get(messageId);
                    request.onsuccess = () =>
                      resolve(Boolean(request.result));
                    request.onerror = () =>
                      reject(request.error);
                  },
                );
              } finally {
                db.close();
              }
            }, sent.id),
          {
            timeout: 10_000,
            message:
              "waiting for the sent plaintext to commit before seeding legacy storage",
          },
        )
        .toBe(true);

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
          // Simulate a locally modified legacy-protection record carrying
          // valid-shaped HUMAN v2 bytes but NOT the HMAC-derived client ID
          // that the original sender signed. Migration protects the bytes,
          // and content binding still prevents impersonating the original.
          plaintext: JSON.stringify({
            type: "human",
            version: 2,
            text: legacyCacheText,
            bindingKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          }),
        },
      );

      await alicePage.reload();
      await expect(
        alicePage.getByTestId("direct-message-undecryptable"),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        alicePage.getByTestId("direct-message-human").filter({ hasText: legacyCacheText }),
      ).toHaveCount(0);

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
        JSON.stringify({
          type: "human",
          version: 2,
          text: legacyPendingText,
          bindingKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        }),
      );
      await alicePage.unroute(
        "**/v1/direct-chats/*/messages",
      );
      await alicePage.reload();
      await expect(
        alicePage.getByTestId("direct-message-undecryptable").first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        alicePage.getByTestId("direct-message-human").filter({ hasText: legacyPendingText }),
      ).toHaveCount(0);
      // Pending outbox bytes remain recoverable/idempotent, but no stale
      // local plaintext may be misattributed to the signed HUMAN v2 ID.
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
    const nikitaHandle = uniqueHandle("h02tabs");
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
        name: "Revocation Peer",
        email: nikitaEmail,
        password,
        handle: nikitaHandle,
      });
      await verifyEmail(
        nikitaPage,
        request,
        nikitaEmail,
      );
      await purchasePro(nikitaPage);
      await nikitaPage.goto("/app");
      await waitForRegisteredDirectChatDevice(nikitaPage);

      const directUrl = await openDirectChat(
        alicePage,
        nikitaHandle,
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
