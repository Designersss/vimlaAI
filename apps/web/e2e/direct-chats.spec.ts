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

    const aliceStaleRecoveryPage =
      await aliceContext.newPage();
    const aliceTakeoverPage =
      await aliceContext.newPage();
    await disableWebLocks(aliceStaleRecoveryPage);
    await disableWebLocks(aliceTakeoverPage);
    await holdFirstPrekeyFetch(
      aliceStaleRecoveryPage,
    );
    const stalePendingRecoveryNavigation =
      aliceStaleRecoveryPage.goto(directUrl);
    await expect.poll(
      () =>
        isPrekeyFetchHeld(
          aliceStaleRecoveryPage,
        ),
    ).toBe(true);

    const aliceRecoveryDeviceId =
      await readLocalDeviceId(
        aliceStaleRecoveryPage,
      );
    expect(aliceRecoveryDeviceId).toBe(
      await readLocalDeviceId(alicePage),
    );
    const recoveryConversationId =
      directConversationId(directUrl);
    const pendingRecoveryLockKey = [
      "vimla-pending-send-recovery",
      recoveryConversationId,
      aliceRecoveryDeviceId,
    ].join(":");
    const leaseTiming = {
      expiresInMs: 1_200,
      hardExpiresInMs: 3_500,
    };
    const shortenedRecoveryLease =
      await shortenActiveRatchetLease(
        aliceStaleRecoveryPage,
        pendingRecoveryLockKey,
        leaseTiming,
      );
    for (const peerDeviceId of [
      aliceRecoveryDeviceId,
      nikitaFirstDeviceId,
      nikitaSecondDeviceId,
    ]) {
      await shortenActiveRatchetLease(
        aliceStaleRecoveryPage,
        [
          "vimla-ratchet",
          recoveryConversationId,
          aliceRecoveryDeviceId,
          peerDeviceId,
        ].join(":"),
        leaseTiming,
      );
    }
    await aliceStaleRecoveryPage.waitForTimeout(
      1_800,
    );
    const renewedRecoveryLease =
      await readRatchetLease(
        aliceStaleRecoveryPage,
        pendingRecoveryLockKey,
      );
    expect(renewedRecoveryLease.owner).toBe(
      shortenedRecoveryLease.owner,
    );
    expect(
      renewedRecoveryLease.expiresAt,
    ).toBeGreaterThan(
      shortenedRecoveryLease.initialExpiresAt,
    );
    expect(
      renewedRecoveryLease.expiresAt,
    ).toBeLessThanOrEqual(
      shortenedRecoveryLease.hardExpiresAt,
    );

    await aliceStaleRecoveryPage.waitForTimeout(
      2_000,
    );
    await aliceTakeoverPage.goto(directUrl);
    await expect(
      aliceTakeoverPage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      aliceTakeoverPage
        .getByTestId("direct-message-human")
        .filter({
          hasText: "pending before peer device change",
        }),
    ).toHaveCount(1);

    await releaseHeldPrekeyFetch(
      aliceStaleRecoveryPage,
    );
    await stalePendingRecoveryNavigation;
    const staleRetry =
      aliceStaleRecoveryPage.getByRole(
        "button",
        { name: /повторить|retry/i },
      );
    await expect(staleRetry).toBeVisible({
      timeout: 20_000,
    });
    await staleRetry.click();
    await expect(
      aliceStaleRecoveryPage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      aliceStaleRecoveryPage
        .getByTestId("direct-message-human")
        .filter({
          hasText: "pending before peer device change",
        }),
    ).toHaveCount(1);
    expect(
      await aliceStaleRecoveryPage.evaluate(
        () => navigator.locks === undefined,
      ),
    ).toBe(true);
    await aliceStaleRecoveryPage.close();
    await aliceTakeoverPage.close();

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

    const legacyFixture = await readLegacyV2Fixture(
      alicePage,
      directConversationId(directUrl),
    );
    const legacyContext = await browser.newContext({
      storageState: await aliceContext.storageState(),
    });
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto("/login");
    await seedLegacyV2Database(
      legacyPage,
      legacyFixture,
    );
    await disableWebLocks(legacyPage);
    await legacyPage.goto(directUrl);
    await expect(
      legacyPage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    const legacyComposer = legacyPage.getByPlaceholder(
      /сообщение этому человеку|message this person/i,
    );
    await legacyComposer.fill("real indexeddb v2 to v4 migration");
    await legacyPage.getByTestId("chat-composer-send").click();
    await expect(
      legacyPage
        .getByTestId("direct-message-human")
        .filter({
          hasText: "real indexeddb v2 to v4 migration",
        }),
    ).toBeVisible({ timeout: 20_000 });
    const migratedRatchet = await readRatchetRecordVersion(
      legacyPage,
      {
        conversationId: directConversationId(directUrl),
        localDeviceId: legacyFixture.deviceId,
        peerDeviceId,
      },
    );
    expect(migratedRatchet.schemaVersion).toBe(1);
    expect(migratedRatchet.stateVersion).toBeGreaterThanOrEqual(1);
    await legacyContext.close();

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

    const fencedContext = await browser.newContext({
      storageState: await aliceContext.storageState(),
    });
    const staleOwnerPage = await fencedContext.newPage();
    const takeoverPage = await fencedContext.newPage();
    await disableWebLocks(staleOwnerPage);
    await disableWebLocks(takeoverPage);

    let signalStaleRegistrationStarted: (() => void) | null =
      null;
    const staleRegistrationStarted = new Promise<void>(
      (resolve) => {
        signalStaleRegistrationStarted = resolve;
      },
    );
    let resumeStaleRegistration: (() => void) | null = null;
    const staleRegistrationResume = new Promise<void>(
      (resolve) => {
        resumeStaleRegistration = resolve;
      },
    );
    let takeoverRegistration:
      | {
          status: number;
          headers: Record<string, string>;
          body: string;
        }
      | null = null;

    await staleOwnerPage.route(
      "**/v1/direct-chats/devices",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        signalStaleRegistrationStarted?.();
        await staleRegistrationResume;
        if (!takeoverRegistration) {
          await route.abort("failed");
          return;
        }
        await route.fulfill(takeoverRegistration);
      },
    );
    await takeoverPage.route(
      "**/v1/direct-chats/devices",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const body = await response.text();
        takeoverRegistration = {
          status: response.status(),
          headers: response.headers(),
          body,
        };
        await route.fulfill(takeoverRegistration);
      },
    );

    const staleNavigation = staleOwnerPage
      .goto(directUrl)
      .catch(() => null);
    await staleRegistrationStarted;
    const shortenedLease =
      await shortenActiveRatchetLease(
        staleOwnerPage,
        "vimla-local-device-bootstrap",
        {
          expiresInMs: 1_200,
          hardExpiresInMs: 3_500,
        },
      );
    await staleOwnerPage.waitForTimeout(1_800);
    const renewedLease = await readRatchetLease(
      staleOwnerPage,
      "vimla-local-device-bootstrap",
    );
    expect(renewedLease.owner).toBe(
      shortenedLease.owner,
    );
    expect(renewedLease.fence).toBe(
      shortenedLease.fence,
    );
    expect(renewedLease.expiresAt).toBeGreaterThan(
      shortenedLease.initialExpiresAt,
    );
    expect(renewedLease.expiresAt).toBeLessThanOrEqual(
      shortenedLease.hardExpiresAt,
    );
    expect(renewedLease.hardExpiresAt).toBe(
      shortenedLease.hardExpiresAt,
    );

    await takeoverPage.goto(directUrl);
    await expect(
      takeoverPage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    expect(takeoverRegistration).not.toBeNull();
    const takeoverDeviceId =
      await readLocalDeviceId(takeoverPage);
    await writeDeviceFenceMarker(
      takeoverPage,
      "takeover-won",
    );

    resumeStaleRegistration?.();
    await staleNavigation;
    await staleOwnerPage.waitForTimeout(500);
    expect(
      await readDeviceFenceMarker(takeoverPage),
    ).toBe("takeover-won");
    expect(
      await readLocalDeviceId(staleOwnerPage),
    ).toBe(takeoverDeviceId);
    await fencedContext.close();

    await nikitaSecondContext.close();
    await aliceContext.close();
    await nikitaContext.close();
  });

  test("recovers operator intent and fails closed on IndexedDB commit abort", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail("e2e-direct-recovery-alice");
    const nikitaEmail = uniqueEmail("e2e-direct-recovery-nikita");

    const aliceContext = await browser.newContext();
    const nikitaContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const nikitaPage = await nikitaContext.newPage();

    await signUp(alicePage, {
      name: "Alice Recovery",
      email: aliceEmail,
      password,
    });
    await verifyEmail(alicePage, request, aliceEmail);
    await purchasePro(alicePage);
    await alicePage.request.patch(
      `${apiBase}/v1/me/preferences`,
      {
        data: { timezone: "Europe/Moscow" },
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
        },
      },
    );

    await signUp(nikitaPage, {
      name: "Nikita Recovery",
      email: nikitaEmail,
      password,
    });
    await verifyEmail(nikitaPage, request, nikitaEmail);
    await purchasePro(nikitaPage);

    await alicePage.goto("/app");
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
    const recoveryDirectUrl = alicePage.url();
    await nikitaPage.goto("/app");
    await nikitaPage
      .getByRole("radio", { name: /личные|direct/i })
      .click();
    await expect(
      nikitaPage.getByTestId("direct-conversation-row"),
    ).toBeVisible({ timeout: 20_000 });
    await nikitaPage
      .getByTestId("direct-conversation-row")
      .click();
    await expect(
      nikitaPage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });

    const composer = alicePage.getByPlaceholder(
      /сообщение этому человеку|message this person/i,
    );
    let messagePosts = 0;
    const countMessagePosts = (outgoing: {
      method(): string;
      url(): string;
    }): void => {
      if (
        outgoing.method() === "POST" &&
        /\/v1\/direct-chats\/[^/]+\/messages$/.test(
          outgoing.url(),
        )
      ) {
        messagePosts += 1;
      }
    };
    alicePage.on("request", countMessagePosts);

    const beforeAbortPosts = messagePosts;
    await failNextIndexedDbPut(
      alicePage,
      "pendingSends",
    );
    try {
      await composer.fill(
        "must not reach server after idb abort",
      );
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await expect(
        alicePage.getByTestId("chat-composer-send"),
      ).toBeEnabled({ timeout: 20_000 });
      await alicePage.waitForTimeout(300);
      expect(messagePosts).toBe(beforeAbortPosts);
    } finally {
      await restoreIndexedDbPut(alicePage);
    }

    await composer.fill("works after idb abort");
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect(
      nikitaPage
        .getByTestId("direct-message-human")
        .filter({ hasText: "works after idb abort" }),
    ).toBeVisible({ timeout: 20_000 });

    let blockInvokeBeforeServer = true;
    let blockedInvokePosts = 0;
    await alicePage.route(
      "**/v1/direct-chats/*/messages",
      async (route) => {
        const body =
          route.request().method() === "POST"
            ? (route.request().postDataJSON() as {
                kind?: string;
              } | null)
            : null;
        if (
          blockInvokeBeforeServer &&
          body?.kind === "OPERATOR_INVOKE"
        ) {
          blockedInvokePosts += 1;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    await composer.fill(
      "@vimla восстанови запуск после смены набора устройств",
    );
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect
      .poll(() => blockedInvokePosts)
      .toBeGreaterThan(0);
    await expect.poll(
      () => readPendingOperatorIntentCount(alicePage),
    ).toBe(1);

    const nikitaSecondContext =
      await browser.newContext({
        storageState:
          await nikitaContext.storageState(),
      });
    const nikitaSecondPage =
      await nikitaSecondContext.newPage();
    await nikitaSecondPage.goto(recoveryDirectUrl);
    await expect(
      nikitaSecondPage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });
    expect(
      await readLocalDeviceId(nikitaSecondPage),
    ).not.toBe(
      await readLocalDeviceId(nikitaPage),
    );

    blockInvokeBeforeServer = false;
    await alicePage.unroute(
      "**/v1/direct-chats/*/messages",
    );
    await composer.fill(
      "trigger operator recovery without reload",
    );
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({
          hasText:
            "trigger operator recovery without reload",
        }),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(
      alicePage
        .getByTestId("direct-message-invoke")
        .filter({
          hasText:
            "восстанови запуск после смены набора устройств",
        }),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(
      alicePage.getByTestId(
        "direct-message-response",
      ),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect.poll(
      () => readPendingOperatorIntentCount(alicePage),
    ).toBe(0);
    for (const page of [
      nikitaPage,
      nikitaSecondPage,
    ]) {
      await expect(
        page
          .getByTestId("direct-message-invoke")
          .filter({
            hasText:
              "восстанови запуск после смены набора устройств",
          }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        page.getByTestId(
          "direct-message-response",
        ),
      ).toHaveCount(1, { timeout: 20_000 });
    }

    const invokeCountBeforeAmbiguous =
      await alicePage
        .getByTestId("direct-message-invoke")
        .count();
    const responseCountBeforeAmbiguous =
      await alicePage
        .getByTestId("direct-message-response")
        .count();

    let abortOperatorAfterCommit = true;
    await alicePage.route(
      "**/v1/operator/runs",
      async (route) => {
        if (
          abortOperatorAfterCommit &&
          route.request().method() === "POST"
        ) {
          await route.fetch();
          abortOperatorAfterCommit = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await composer.fill(
      "@vimla восстанови этот запуск после потери ответа",
    );
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect.poll(
      () => abortOperatorAfterCommit,
    ).toBe(false);
    await alicePage.unroute("**/v1/operator/runs");
    await expect(
      alicePage.getByTestId("direct-message-invoke"),
    ).toHaveCount(
      invokeCountBeforeAmbiguous + 1,
      { timeout: 20_000 },
    );
    await expect.poll(
      () => readPendingOperatorIntentCount(alicePage),
    ).toBe(1);

    let abortFirstOperatorOutputBeforeServer = true;
    await aliceContext.route(
      "**/v1/direct-chats/*/messages",
      async (route) => {
        const body =
          route.request().method() === "POST"
            ? (route.request().postDataJSON() as {
                kind?: string;
              } | null)
            : null;
        if (
          abortFirstOperatorOutputBeforeServer &&
          body?.kind === "OPERATOR_RESPONSE"
        ) {
          abortFirstOperatorOutputBeforeServer = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    const aliceRecoveryPage =
      await aliceContext.newPage();
    await Promise.all([
      alicePage.reload(),
      aliceRecoveryPage.goto(recoveryDirectUrl),
    ]);
    for (const page of [
      alicePage,
      aliceRecoveryPage,
    ]) {
      await expect(
        page.getByTestId("direct-chat-shell"),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByTestId("direct-message-invoke"),
      ).toHaveCount(
        invokeCountBeforeAmbiguous + 1,
        { timeout: 20_000 },
      );
      await expect(
        page.getByTestId("direct-message-response"),
      ).toHaveCount(
        responseCountBeforeAmbiguous + 1,
        { timeout: 20_000 },
      );
    }
    await expect.poll(
      () => readPendingOperatorIntentCount(alicePage),
    ).toBe(0);
    expect(
      abortFirstOperatorOutputBeforeServer,
    ).toBe(false);
    await aliceContext.unroute(
      "**/v1/direct-chats/*/messages",
    );
    for (const page of [
      nikitaPage,
      nikitaSecondPage,
    ]) {
      await expect(
        page.getByTestId("direct-message-invoke"),
      ).toHaveCount(
        invokeCountBeforeAmbiguous + 1,
        { timeout: 20_000 },
      );
      await expect(
        page.getByTestId("direct-message-response"),
      ).toHaveCount(
        responseCountBeforeAmbiguous + 1,
        { timeout: 20_000 },
      );
    }

    const invokeCountBeforeOperatorTakeover =
      await alicePage
        .getByTestId("direct-message-invoke")
        .count();
    const responseCountBeforeOperatorTakeover =
      await alicePage
        .getByTestId("direct-message-response")
        .count();
    await installHeldOperatorRunResponse(
      alicePage,
    );
    await composer.fill(
      "@vimla проверь takeover operator lease",
    );
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect.poll(
      () => isOperatorRunResponseHeld(alicePage),
    ).toBe(true);

    const operatorLocalDeviceId =
      await readLocalDeviceId(alicePage);
    const operatorLockKey = [
      "vimla-pending-operator-intent",
      directConversationId(recoveryDirectUrl),
      operatorLocalDeviceId,
    ].join(":");
    const shortenedOperatorLease =
      await shortenActiveRatchetLease(
        alicePage,
        operatorLockKey,
        {
          expiresInMs: 1_200,
          hardExpiresInMs: 3_500,
        },
      );
    await alicePage.waitForTimeout(1_800);
    const renewedOperatorLease =
      await readRatchetLease(
        alicePage,
        operatorLockKey,
      );
    expect(renewedOperatorLease.owner).toBe(
      shortenedOperatorLease.owner,
    );
    expect(
      renewedOperatorLease.expiresAt,
    ).toBeGreaterThan(
      shortenedOperatorLease.initialExpiresAt,
    );
    expect(
      renewedOperatorLease.expiresAt,
    ).toBeLessThanOrEqual(
      shortenedOperatorLease.hardExpiresAt,
    );

    await alicePage.waitForTimeout(2_000);
    await aliceRecoveryPage.reload();
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-message-invoke",
      ),
    ).toHaveCount(
      invokeCountBeforeOperatorTakeover + 1,
      { timeout: 20_000 },
    );
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-message-response",
      ),
    ).toHaveCount(
      responseCountBeforeOperatorTakeover + 1,
      { timeout: 20_000 },
    );
    await expect.poll(
      () =>
        readPendingOperatorIntentCount(
          aliceRecoveryPage,
        ),
    ).toBe(0);

    await releaseHeldOperatorRunResponse(
      alicePage,
    );
    await expect(
      alicePage.getByTestId("chat-composer-send"),
    ).toBeEnabled({ timeout: 20_000 });
    await alicePage.waitForTimeout(500);
    await expect(
      alicePage.getByTestId(
        "direct-message-response",
      ),
    ).toHaveCount(
      responseCountBeforeOperatorTakeover + 1,
      { timeout: 20_000 },
    );
    for (const page of [
      nikitaPage,
      nikitaSecondPage,
    ]) {
      await expect(
        page.getByTestId("direct-message-invoke"),
      ).toHaveCount(
        invokeCountBeforeOperatorTakeover + 1,
        { timeout: 20_000 },
      );
      await expect(
        page.getByTestId("direct-message-response"),
      ).toHaveCount(
        responseCountBeforeOperatorTakeover + 1,
        { timeout: 20_000 },
      );
    }

    const invokeCountBeforeLateResponse =
      await alicePage
        .getByTestId("direct-message-invoke")
        .count();
    const responseCountBeforeLateResponse =
      await alicePage
        .getByTestId("direct-message-response")
        .count();
    await installLateDirectInvokeResponse(
      alicePage,
    );

    await composer.fill(
      "@vimla проверь поздний ответ исходного invoke",
    );
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect.poll(
      () => isLateDirectInvokeCommitted(alicePage),
    ).toBe(true);

    await aliceRecoveryPage.reload();
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-message-invoke",
      ),
    ).toHaveCount(
      invokeCountBeforeLateResponse + 1,
      { timeout: 20_000 },
    );
    await expect(
      aliceRecoveryPage.getByTestId(
        "direct-message-response",
      ),
    ).toHaveCount(
      responseCountBeforeLateResponse + 1,
      { timeout: 20_000 },
    );
    await expect.poll(
      () =>
        readPendingOperatorIntentCount(
          aliceRecoveryPage,
        ),
    ).toBe(0);

    await releaseLateDirectInvokeResponse(
      alicePage,
    );
    await expect(
      alicePage.getByTestId("chat-composer-send"),
    ).toBeEnabled({ timeout: 20_000 });
    await alicePage.waitForTimeout(500);
    expect(
      await readPendingOperatorIntentCount(alicePage),
    ).toBe(0);
    await expect(
      alicePage.getByTestId(
        "direct-message-response",
      ),
    ).toHaveCount(
      responseCountBeforeLateResponse + 1,
      { timeout: 20_000 },
    );
    for (const page of [
      nikitaPage,
      nikitaSecondPage,
    ]) {
      await expect(
        page.getByTestId("direct-message-invoke"),
      ).toHaveCount(
        invokeCountBeforeLateResponse + 1,
        { timeout: 20_000 },
      );
      await expect(
        page.getByTestId("direct-message-response"),
      ).toHaveCount(
        responseCountBeforeLateResponse + 1,
        { timeout: 20_000 },
      );
    }

    alicePage.off("request", countMessagePosts);
    await aliceRecoveryPage.close();
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

async function holdFirstPrekeyFetch(
  page: Page,
): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaOriginalPrekeyFetch?: typeof fetch;
      __vimlaPrekeyFetchHeld?: boolean;
      __vimlaReleasePrekeyFetch?: () => void;
    };
    const originalFetch = globalThis.fetch;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.__vimlaOriginalPrekeyFetch =
      originalFetch;
    state.__vimlaPrekeyFetchHeld = false;
    state.__vimlaReleasePrekeyFetch = () => {
      release?.();
    };
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        !state.__vimlaPrekeyFetchHeld &&
        /\/v1\/direct-chats\/users\/[^/]+\/prekeys$/.test(
          url,
        )
      ) {
        state.__vimlaPrekeyFetchHeld = true;
        await gate;
      }
      return originalFetch(input, init);
    };
  });
}

async function isPrekeyFetchHeld(
  page: Page,
): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __vimlaPrekeyFetchHeld?: boolean;
      };
      return state.__vimlaPrekeyFetchHeld === true;
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      /Execution context was destroyed|Cannot find context with specified id/i.test(
        error.message,
      )
    ) {
      return false;
    }
    throw error;
  }
}

async function releaseHeldPrekeyFetch(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaOriginalPrekeyFetch?: typeof fetch;
      __vimlaReleasePrekeyFetch?: () => void;
    };
    state.__vimlaReleasePrekeyFetch?.();
    if (state.__vimlaOriginalPrekeyFetch) {
      globalThis.fetch =
        state.__vimlaOriginalPrekeyFetch;
    }
  });
}

async function installHeldOperatorRunResponse(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaOriginalOperatorFetch?: typeof fetch;
      __vimlaOperatorResponseHeld?: boolean;
      __vimlaReleaseOperatorResponse?: () => void;
    };
    if (state.__vimlaOriginalOperatorFetch) {
      throw new Error(
        "Held Operator response fixture is already installed",
      );
    }
    const originalFetch = globalThis.fetch;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.__vimlaOriginalOperatorFetch =
      originalFetch;
    state.__vimlaOperatorResponseHeld = false;
    state.__vimlaReleaseOperatorResponse = () => {
      release?.();
    };

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        !state.__vimlaOperatorResponseHeld &&
        init?.method?.toUpperCase() === "POST" &&
        /\/v1\/operator\/runs$/.test(url)
      ) {
        const response = await originalFetch(
          input,
          init,
        );
        state.__vimlaOperatorResponseHeld = true;
        await gate;
        return response;
      }
      return originalFetch(input, init);
    };
  });
}

async function isOperatorRunResponseHeld(
  page: Page,
): Promise<boolean> {
  return page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaOperatorResponseHeld?: boolean;
    };
    return state.__vimlaOperatorResponseHeld === true;
  });
}

async function releaseHeldOperatorRunResponse(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaOriginalOperatorFetch?: typeof fetch;
      __vimlaReleaseOperatorResponse?: () => void;
    };
    state.__vimlaReleaseOperatorResponse?.();
    if (state.__vimlaOriginalOperatorFetch) {
      globalThis.fetch =
        state.__vimlaOriginalOperatorFetch;
    }
    delete state.__vimlaOriginalOperatorFetch;
    delete state.__vimlaOperatorResponseHeld;
    delete state.__vimlaReleaseOperatorResponse;
  });
}

async function installLateDirectInvokeResponse(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaLateInvokeOriginalFetch?: typeof fetch;
      __vimlaLateInvokeCommitted?: boolean;
      __vimlaReleaseLateInvoke?: () => void;
    };
    if (state.__vimlaLateInvokeOriginalFetch) {
      throw new Error(
        "Late Direct Chat invoke fixture is already installed",
      );
    }
    const originalFetch = globalThis.fetch;
    let release: (() => void) | null = null;
    const responseGate = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );
    state.__vimlaLateInvokeOriginalFetch =
      originalFetch;
    state.__vimlaLateInvokeCommitted = false;
    state.__vimlaReleaseLateInvoke = () => {
      release?.();
    };

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let kind: string | undefined;
      if (
        init?.method?.toUpperCase() === "POST" &&
        typeof init.body === "string"
      ) {
        try {
          kind = (
            JSON.parse(init.body) as {
              kind?: string;
            }
          ).kind;
        } catch {
          kind = undefined;
        }
      }
      if (
        !state.__vimlaLateInvokeCommitted &&
        kind === "OPERATOR_INVOKE" &&
        /\/v1\/direct-chats\/[^/]+\/messages$/.test(
          url,
        )
      ) {
        const response = await originalFetch(
          input,
          init,
        );
        state.__vimlaLateInvokeCommitted = true;
        await responseGate;
        return response;
      }
      return originalFetch(input, init);
    };
  });
}

async function isLateDirectInvokeCommitted(
  page: Page,
): Promise<boolean> {
  return page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaLateInvokeCommitted?: boolean;
    };
    return state.__vimlaLateInvokeCommitted === true;
  });
}

async function releaseLateDirectInvokeResponse(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaLateInvokeOriginalFetch?: typeof fetch;
      __vimlaLateInvokeCommitted?: boolean;
      __vimlaReleaseLateInvoke?: () => void;
    };
    state.__vimlaReleaseLateInvoke?.();
    if (state.__vimlaLateInvokeOriginalFetch) {
      globalThis.fetch =
        state.__vimlaLateInvokeOriginalFetch;
    }
    delete state.__vimlaLateInvokeOriginalFetch;
    delete state.__vimlaLateInvokeCommitted;
    delete state.__vimlaReleaseLateInvoke;
  });
}

async function failNextIndexedDbPut(
  page: Page,
  storeName: string,
): Promise<void> {
  await page.evaluate((targetStore) => {
    const state = globalThis as typeof globalThis & {
      __vimlaRestoreIndexedDbPut?: () => void;
    };
    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let armed = true;
    prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (armed && this.name === targetStore) {
        armed = false;
        throw new DOMException(
          "Simulated IndexedDB quota failure",
          "QuotaExceededError",
        );
      }
      return Reflect.apply(
        originalPut,
        this,
        key === undefined ? [value] : [value, key],
      ) as IDBRequest<IDBValidKey>;
    };
    state.__vimlaRestoreIndexedDbPut = () => {
      prototype.put = originalPut;
      delete state.__vimlaRestoreIndexedDbPut;
    };
  }, storeName);
}

async function restoreIndexedDbPut(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vimlaRestoreIndexedDbPut?: () => void;
    };
    state.__vimlaRestoreIndexedDbPut?.();
  });
}

async function readPendingOperatorIntentCount(
  page: Page,
): Promise<number> {
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
              new Error(
                "Pending operator intent database read failed",
              ),
          );
      },
    );
    try {
      return await new Promise<number>(
        (resolve, reject) => {
          const tx = db.transaction(
            "pendingSends",
            "readonly",
          );
          const request = tx
            .objectStore("pendingSends")
            .getAll();
          request.onsuccess = () => {
            const rows = request.result as Array<{
              operatorIntent?: unknown;
            }>;
            resolve(
              rows.filter(
                (row) => row.operatorIntent !== undefined,
              ).length,
            );
          };
          request.onerror = () =>
            reject(
              request.error ??
                new Error(
                  "Pending operator intent read failed",
                ),
            );
        },
      );
    } finally {
      db.close();
    }
  });
}

async function disableWebLocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
}

async function shortenActiveRatchetLease(
  page: Page,
  key: string,
  timing: {
    expiresInMs: number;
    hardExpiresInMs: number;
  },
): Promise<{
  owner: string;
  fence: number;
  initialExpiresAt: number;
  hardExpiresAt: number;
}> {
  return page.evaluate(
    async ({ lockKey, expiresInMs, hardExpiresInMs }) => {
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
                new Error(
                  "E2EE database open failed",
                ),
            );
        },
      );
      try {
        return await new Promise<{
        owner: string;
        fence: number;
        initialExpiresAt: number;
        hardExpiresAt: number;
      }>((resolve, reject) => {
          const tx = db.transaction(
            "ratchetLocks",
            "readwrite",
          );
          const store = tx.objectStore("ratchetLocks");
          const request = store.get(lockKey);
          request.onsuccess = () => {
            const current = request.result as {
              owner?: unknown;
              fence?: unknown;
              expiresAt?: unknown;
            } | undefined;
            if (
              !current ||
              typeof current.owner !== "string" ||
              typeof current.fence !== "number" ||
              typeof current.expiresAt !== "number"
            ) {
              reject(
                new Error(
                  "Active ratchet lease is missing",
                ),
              );
              tx.abort();
              return;
            }
            const now = Date.now();
            const initialExpiresAt =
              now + expiresInMs;
            const hardExpiresAt =
              now + hardExpiresInMs;
            store.put(
              {
                owner: current.owner,
                fence: current.fence,
                expiresAt: initialExpiresAt,
                hardExpiresAt,
              },
              lockKey,
            );
            tx.oncomplete = () =>
              resolve({
                owner: current.owner as string,
                fence: current.fence as number,
                initialExpiresAt,
                hardExpiresAt,
              });
          };
          request.onerror = () =>
            reject(
              request.error ??
                new Error(
                  "Ratchet lease read failed",
                ),
            );
          tx.onabort = () =>
            reject(
              tx.error ??
                new Error(
                  "Ratchet lease update aborted",
                ),
            );
        });
      } finally {
        db.close();
      }
    },
    {
      lockKey: key,
      expiresInMs: timing.expiresInMs,
      hardExpiresInMs: timing.hardExpiresInMs,
    },
  );
}

async function readRatchetLease(
  page: Page,
  key: string,
): Promise<{
  owner: string;
  fence: number;
  expiresAt: number;
  hardExpiresAt: number;
}> {
  return page.evaluate(async (lockKey) => {
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
                new Error(
                  "E2EE database open failed",
                ),
            );
        },
      );
    try {
      return await new Promise<{
        owner: string;
        fence: number;
        expiresAt: number;
        hardExpiresAt: number;
      }>((resolve, reject) => {
        const tx = db.transaction(
          "ratchetLocks",
          "readonly",
        );
        const request = tx
          .objectStore("ratchetLocks")
          .get(lockKey);
        request.onsuccess = () => {
          const value = request.result as {
            owner?: unknown;
            fence?: unknown;
            expiresAt?: unknown;
            hardExpiresAt?: unknown;
          } | undefined;
          if (
            !value ||
            typeof value.owner !== "string" ||
            typeof value.fence !== "number" ||
            typeof value.expiresAt !== "number" ||
            typeof value.hardExpiresAt !== "number"
          ) {
            reject(
              new Error(
                "Ratchet lease record is invalid",
              ),
            );
            return;
          }
          resolve({
            owner: value.owner,
            fence: value.fence,
            expiresAt: value.expiresAt,
            hardExpiresAt: value.hardExpiresAt,
          });
        };
        request.onerror = () =>
          reject(
            request.error ??
              new Error(
                "Ratchet lease read failed",
              ),
          );
      });
    } finally {
      db.close();
    }
  }, key);
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

async function writeDeviceFenceMarker(
  page: Page,
  marker: string,
): Promise<void> {
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("E2EE IndexedDB open failed"),
        );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("device", "readwrite");
        const store = tx.objectStore("device");
        const request = store.get("local");
        request.onsuccess = () => {
          const current = request.result as
            | Record<string, unknown>
            | undefined;
          if (!current) {
            reject(new Error("Local E2EE device is missing"));
            tx.abort();
            return;
          }
          store.put(
            {
              ...current,
              __fenceTestMarker: value,
            },
            "local",
          );
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(
            tx.error ??
              new Error("Device marker write failed"),
          );
        tx.onabort = () =>
          reject(
            tx.error ??
              new Error("Device marker write aborted"),
          );
      });
    } finally {
      db.close();
    }
  }, marker);
}

async function readDeviceFenceMarker(
  page: Page,
): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("E2EE IndexedDB open failed"),
        );
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction("device", "readonly");
        const request = tx.objectStore("device").get("local");
        request.onsuccess = () => {
          const current = request.result as
            | { __fenceTestMarker?: unknown }
            | undefined;
          resolve(
            typeof current?.__fenceTestMarker === "string"
              ? current.__fenceTestMarker
              : null,
          );
        };
        request.onerror = () =>
          reject(
            request.error ??
              new Error("Device marker read failed"),
          );
      });
    } finally {
      db.close();
    }
  });
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

interface LegacyV2Fixture {
  deviceId: string;
  device: unknown;
  ratchets: Array<{
    key: string;
    state: unknown;
  }>;
}

async function readLegacyV2Fixture(
  page: Page,
  conversationId: string,
): Promise<LegacyV2Fixture> {
  return page.evaluate(async (targetConversationId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vimla-direct-e2ee", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("E2EE IndexedDB open failed"),
        );
    });
    try {
      const device = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const tx = db.transaction("device", "readonly");
          const request = tx.objectStore("device").get("local");
          request.onsuccess = () => {
            const value = request.result;
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value)
            ) {
              reject(
                new Error("Legacy device fixture is missing"),
              );
              return;
            }
            resolve(value as Record<string, unknown>);
          };
          request.onerror = () =>
            reject(
              request.error ??
                new Error("Legacy device fixture read failed"),
            );
        },
      );
      if (typeof device.deviceId !== "string") {
        throw new Error("Legacy device fixture is missing");
      }
      const deviceId = device.deviceId;
      const prefix =
        `${targetConversationId}:${deviceId}:`;
      const ratchets = await new Promise<
        Array<{ key: string; state: unknown }>
      >((resolve, reject) => {
        const rows: Array<{
          key: string;
          state: unknown;
        }> = [];
        const tx = db.transaction("ratchets", "readonly");
        const request = tx
          .objectStore("ratchets")
          .openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(rows);
            return;
          }
          const key = String(cursor.key);
          const value = cursor.value as
            | { state?: unknown }
            | undefined;
          if (
            key.startsWith(prefix) &&
            value?.state !== undefined
          ) {
            rows.push({
              key:
                `${targetConversationId}:${key.slice(
                  prefix.length,
                )}`,
              state: value.state,
            });
          }
          cursor.continue();
        };
        request.onerror = () =>
          reject(
            request.error ??
              new Error("Legacy ratchet fixture read failed"),
          );
      });
      if (ratchets.length === 0) {
        throw new Error("Legacy ratchet fixture is empty");
      }
      return {
        deviceId,
        device,
        ratchets,
      };
    } finally {
      db.close();
    }
  }, conversationId);
}

async function seedLegacyV2Database(
  page: Page,
  fixture: LegacyV2Fixture,
): Promise<void> {
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(
        "vimla-direct-e2ee",
      );
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Legacy IndexedDB reset failed"),
        );
      request.onblocked = () =>
        reject(
          new Error("Legacy IndexedDB reset was blocked"),
        );
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        "vimla-direct-e2ee",
        2,
      );
      request.onupgradeneeded = () => {
        const created = request.result;
        created.createObjectStore("device");
        created.createObjectStore("ratchets");
        created.createObjectStore("plaintexts");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Legacy IndexedDB create failed"),
        );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["device", "ratchets"],
          "readwrite",
        );
        tx.objectStore("device").put(
          value.device,
          "local",
        );
        const ratchets = tx.objectStore("ratchets");
        for (const row of value.ratchets) {
          ratchets.put(row.state, row.key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(
            tx.error ??
              new Error("Legacy IndexedDB seed failed"),
          );
        tx.onabort = () =>
          reject(
            tx.error ??
              new Error("Legacy IndexedDB seed aborted"),
          );
      });
    } finally {
      db.close();
    }
  }, fixture);
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

