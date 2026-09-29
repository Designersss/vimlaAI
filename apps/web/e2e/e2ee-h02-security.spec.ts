import { expect, test, type Page } from "@playwright/test";
import {
  apiBase,
  purchasePro,
  webOrigin,
  signUp,
  uniqueEmail,
  verifyEmail,
  waitForRegisteredDirectChatDevice,
} from "./helpers";

const PROTECTED_PREFIX = "vimla-protected:v1:";

async function openDirectChat(
  alicePage: Page,
  nikitaEmail: string,
): Promise<string> {
  await alicePage.goto("/app");
  await expect(
    alicePage.getByRole("heading", {
      name: /сообщения|messages/i,
    }),
  ).toBeVisible();
  await alicePage
    .getByRole("button", {
      name: /новый личный чат|new direct chat/i,
    })
    .click();
  await alicePage
    .getByLabel(/email участника|participant email/i)
    .fill(nikitaEmail);
  await alicePage
    .getByRole("button", {
      name: /начать чат|start chat/i,
    })
    .click();
  await expect(
    alicePage.getByTestId("direct-chat-shell"),
  ).toBeVisible({ timeout: 20_000 });
  return alicePage.url();
}

async function readProtectedStorage(page: Page): Promise<{
  deviceSecret: string | null;
  deviceProtectionVersions: number[];
  ratchetSchemaVersions: number[];
  ratchetStates: string[];
  plaintexts: string[];
  plaintextProtectionVersions: number[];
  pendingPlaintexts: string[];
  pendingProtectionVersions: number[];
  keyExtractable: boolean | null;
}> {
  return page.evaluate(async () => {
    async function readStore(
      dbName: string,
      storeName: string,
    ): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(
            storeName,
            "readonly",
          );
          const request = tx
            .objectStore(storeName)
            .getAll();
          request.onsuccess = () => {
            resolve(request.result as unknown[]);
          };
          request.onerror = () =>
            reject(request.error);
          tx.oncomplete = () => db.close();
        };
      });
    }

    const deviceRows = (await readStore(
      "vimla-direct-e2ee",
      "device",
    )) as Array<{
      protectionVersion?: number;
      identity?: { ed25519Secret?: string };
    }>;
    const ratchets = (await readStore(
      "vimla-direct-e2ee",
      "ratchets",
    )) as Array<{
      schemaVersion?: number;
      protectedState?: string;
    }>;
    const plaintexts = (await readStore(
      "vimla-direct-e2ee",
      "plaintexts",
    )) as Array<{
      protectionVersion?: number;
      text?: string;
    }>;
    const pending = (await readStore(
      "vimla-direct-e2ee",
      "pendingSends",
    )) as Array<{
      protectionVersion?: number;
      plaintext?: string;
    }>;

    const keyRows = (await readStore(
      "vimla-e2ee-keyring",
      "keys",
    )) as CryptoKey[];

    return {
      deviceSecret:
        deviceRows[0]?.identity?.ed25519Secret ??
        null,
      deviceProtectionVersions: deviceRows
        .map((row) => row.protectionVersion)
        .filter(
          (value): value is number =>
            typeof value === "number",
        ),
      ratchetSchemaVersions: ratchets
        .map((row) => row.schemaVersion)
        .filter(
          (value): value is number =>
            typeof value === "number",
        ),
      ratchetStates: ratchets
        .map((row) => row.protectedState)
        .filter(
          (value): value is string =>
            typeof value === "string",
        ),
      plaintexts: plaintexts
        .map((row) => row.text)
        .filter(
          (value): value is string =>
            typeof value === "string",
        ),
      plaintextProtectionVersions: plaintexts
        .map((row) => row.protectionVersion)
        .filter(
          (value): value is number =>
            typeof value === "number",
        ),
      pendingPlaintexts: pending
        .map((row) => row.plaintext)
        .filter(
          (value): value is string =>
            typeof value === "string",
        ),
      pendingProtectionVersions: pending
        .map((row) => row.protectionVersion)
        .filter(
          (value): value is number =>
            typeof value === "number",
        ),
      keyExtractable:
        keyRows[0]?.extractable ?? null,
    };
  });
}

async function localDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter(
        (name): name is string =>
          typeof name === "string",
      );
  });
}

test.describe("E2EE H02 browser hardening", () => {
  test("serves a nonce CSP and hardened response headers", async ({
    page,
  }) => {
    const first = await page.goto("/sign-in");
    expect(first).not.toBeNull();
    const firstHeaders = first?.headers() ?? {};
    const firstCsp =
      firstHeaders["content-security-policy"] ?? "";

    expect(firstCsp).toContain(
      "script-src 'self' 'nonce-",
    );
    expect(firstCsp).toContain(
      "frame-ancestors 'none'",
    );
    expect(firstCsp).toContain("object-src 'none'");
    const scriptPolicy = firstCsp
      .split("; ")
      .find((directive) =>
        directive.startsWith("script-src "),
      );
    expect(scriptPolicy).toBeTruthy();
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    // Playwright runs the web app with next dev, where the policy
    // intentionally permits the evaluator required by Next/React.
    // The production no-unsafe-eval invariant is covered by
    // security-policy.test.ts against development: false.
    expect(scriptPolicy).toContain("'unsafe-eval'");
    expect(firstCsp).toContain(
      "style-src-attr 'unsafe-inline'",
    );
    expect(
      firstHeaders["x-content-type-options"],
    ).toBe("nosniff");
    expect(firstHeaders["referrer-policy"]).toBe(
      "no-referrer",
    );
    expect(firstHeaders["x-frame-options"]).toBe(
      "DENY",
    );
    expect(
      firstHeaders["permissions-policy"],
    ).toContain("camera=()");

    const firstNonce =
      firstCsp.match(/'nonce-([^']+)'/)?.[1];
    const second = await page.reload();
    const secondCsp =
      second?.headers()[
        "content-security-policy"
      ] ?? "";
    const secondNonce =
      secondCsp.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(secondNonce).not.toBe(firstNonce);

    const themeScriptNonce = await page
      .locator("script")
      .evaluateAll((scripts) => {
        const bootstrap = scripts.find((script) =>
          script.textContent?.includes(
            "vimla_appearance",
          ),
        );
        return bootstrap?.nonce ?? null;
      });
    expect(themeScriptNonce).toBe(secondNonce);

    await page.goto("/dev/ui");
    const progressFill = page
      .getByRole("progressbar")
      .first()
      .locator("span");
    await expect(progressFill).toHaveAttribute(
      "style",
      /width:\s*\d+%/,
    );
  });

  test("protects persisted E2EE data, renders hostile text inert, and wipes on logout", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail(
      "h02-alice",
    );
    const nikitaEmail = uniqueEmail(
      "h02-nikita",
    );
    const aliceContext =
      await browser.newContext();
    const nikitaContext =
      await browser.newContext();
    const alicePage =
      await aliceContext.newPage();
    const nikitaPage =
      await nikitaContext.newPage();

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
    await waitForRegisteredDirectChatDevice(nikitaPage);

    await openDirectChat(
      alicePage,
      nikitaEmail,
    );
    const composer =
      alicePage.getByPlaceholder(
        /сообщение этому человеку|message this person/i,
      );

    const hostile =
      "<img src=x onerror=\"window.__vimlaH02Xss='executed'\">";
    await composer.fill(hostile);
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({ hasText: hostile }),
    ).toBeVisible({ timeout: 20_000 });
    expect(
      await alicePage.evaluate(
        () =>
          (
            window as Window & {
              __vimlaH02Xss?: string;
            }
          ).__vimlaH02Xss,
      ),
    ).toBeUndefined();

    const persisted =
      await readProtectedStorage(alicePage);
    expect(
      persisted.deviceSecret?.startsWith(
        PROTECTED_PREFIX,
      ),
    ).toBe(true);
    expect(persisted.keyExtractable).toBe(false);
    expect(
      persisted.ratchetSchemaVersions.length,
    ).toBeGreaterThan(0);
    expect(
      persisted.ratchetSchemaVersions.every(
        (version) => version === 2,
      ),
    ).toBe(true);
    expect(
      persisted.ratchetStates.every((state) =>
        state.startsWith(PROTECTED_PREFIX),
      ),
    ).toBe(true);
    expect(
      persisted.plaintexts.some((text) =>
        text.includes(hostile),
      ),
    ).toBe(false);
    expect(
      persisted.plaintexts.every((text) =>
        text.startsWith(PROTECTED_PREFIX),
      ),
    ).toBe(true);

    await alicePage.route(
      "**/v1/direct-chats/*/messages",
      async (route) => {
        if (route.request().method() === "POST") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    const pendingSecret =
      "pending local secret h02";
    await composer.fill(pendingSecret);
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect
      .poll(async () => {
        const state =
          await readProtectedStorage(alicePage);
        return state.pendingPlaintexts.length;
      })
      .toBeGreaterThan(0);

    const withPending =
      await readProtectedStorage(alicePage);
    expect(
      withPending.pendingPlaintexts.some(
        (text) => text.includes(pendingSecret),
      ),
    ).toBe(false);
    expect(
      withPending.pendingPlaintexts.every(
        (text) =>
          text.startsWith(PROTECTED_PREFIX),
      ),
    ).toBe(true);
    await alicePage.unroute(
      "**/v1/direct-chats/*/messages",
    );

    const beforeLogout =
      await readProtectedStorage(alicePage);
    expect(beforeLogout.deviceSecret).toContain(
      PROTECTED_PREFIX,
    );

    await alicePage
      .getByRole("button", {
        name: /выйти|sign out/i,
      })
      .click();
    await expect(alicePage).toHaveURL(
      /\/sign-in/,
      { timeout: 20_000 },
    );
    const afterLogout =
      await localDatabases(alicePage);
    expect(afterLogout).not.toContain(
      "vimla-direct-e2ee",
    );
    expect(afterLogout).not.toContain(
      "vimla-e2ee-keyring",
    );

    await aliceContext.close();
    await nikitaContext.close();
  });

  test("wipes protected local state when the server reports the current device revoked", async ({
    browser,
    request,
  }) => {
    test.setTimeout(150_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail(
      "h02-revoke-alice",
    );
    const nikitaEmail = uniqueEmail(
      "h02-revoke-nikita",
    );
    const aliceContext =
      await browser.newContext();
    const nikitaContext =
      await browser.newContext();
    const alicePage =
      await aliceContext.newPage();
    const nikitaPage =
      await nikitaContext.newPage();

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
    await waitForRegisteredDirectChatDevice(nikitaPage);

    await openDirectChat(
      alicePage,
      nikitaEmail,
    );
    const localDeviceId =
      await alicePage.evaluate(async () => {
        return new Promise<string>(
          (resolve, reject) => {
            const open = indexedDB.open(
              "vimla-direct-e2ee",
            );
            open.onerror = () =>
              reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction(
                "device",
                "readonly",
              );
              const request = tx
                .objectStore("device")
                .get("local");
              request.onsuccess = () => {
                const row = request.result as {
                  deviceId: string;
                };
                resolve(row.deviceId);
              };
              request.onerror = () =>
                reject(request.error);
              tx.oncomplete = () => db.close();
            };
          },
        );
      });

    const revoke = await alicePage.request.post(
      `${apiBase}/v1/direct-chats/devices/${encodeURIComponent(
        localDeviceId,
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

    // The revocation error must not silently re-enroll a replacement device
    // in the same recovery attempt.
    const devices = await alicePage.request.get(
      `${apiBase}/v1/direct-chats/devices`,
    );
    expect(devices.ok()).toBe(true);
    const payload = (await devices.json()) as {
      items: Array<{
        id: string;
        revoked: boolean;
      }>;
    };
    expect(
      payload.items.filter(
        (item) => !item.revoked,
      ),
    ).toHaveLength(0);

    await aliceContext.close();
    await nikitaContext.close();
  });
});
