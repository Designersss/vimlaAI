import {
  expect,
  test,
} from "@playwright/test";
import {
  apiBase,
  purchasePro,
  signUp,
  uniqueEmail,
  uniqueHandle,
  verifyEmail,
  webOrigin,
} from "./helpers";

test.describe("Unified Inbox", () => {
  test("mixes AI and Direct surfaces in one ordered feed and resolves Direct preview only after local decrypt", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const password =
      "correct-horse-battery";
    const bobEmail = uniqueEmail(
      "e2e-inbox-bob",
    );
    const bobHandle = uniqueHandle(
      "inboxbob",
    );
    const aliceEmail = uniqueEmail(
      "e2e-inbox-alice",
    );
    const aliceHandle = uniqueHandle(
      "inboxalice",
    );

    const bobContext =
      await browser.newContext();
    const aliceContext =
      await browser.newContext();
    const bobPage =
      await bobContext.newPage();
    const alicePage =
      await aliceContext.newPage();

    await signUp(bobPage, {
      name: "Inbox Bob",
      email: bobEmail,
      password,
      handle: bobHandle,
    });
    await verifyEmail(
      bobPage,
      request,
      bobEmail,
    );
    await purchasePro(bobPage);

    // Booting Messages also establishes Bob's local E2EE device.
    await bobPage.goto("/app");
    await expect(
      bobPage.getByRole("heading", {
        name: /сообщения|messages/i,
      }),
    ).toBeVisible();

    // Inbox readiness is independent from Direct crypto bootstrap, but a
    // recipient device still becomes available in the background.
    await expect
      .poll(
        async () => {
          const response = await bobPage.request.get(
            `${apiBase}/v1/direct-chats/devices`,
            { headers: { origin: webOrigin } },
          );
          if (!response.ok()) {
            return 0;
          }
          const payload = (await response.json()) as {
            items: unknown[];
          };
          return payload.items.length;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    await bobPage
      .getByRole("button", {
        name: /новый разговор|new conversation/i,
      })
      .click();
    const aiComposer =
      bobPage.getByPlaceholder(
        /сообщение для vimla|message vimla/i,
      );
    await aiComposer.fill(
      "older unified inbox activity",
    );
    await bobPage
      .getByRole("button", {
        name: /отправить|send/i,
      })
      .click();
    await expect(
      bobPage.getByText(
        "Hello from Vimla",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      bobPage.getByTestId(
        "unified-inbox-list",
      ),
    ).toContainText("Hello from Vimla", {
      timeout: 20_000,
    });

    const aiInboxResponse =
      await bobPage.request.get(
        `${apiBase}/v1/inbox?kind=AI_THREAD`,
      );
    expect(aiInboxResponse.ok()).toBe(true);
    const aiInboxPayload =
      (await aiInboxResponse.json()) as {
        items: Array<{
          surfaceId: string;
          domainId: string;
        }>;
      };
    const aiInboxItem =
      aiInboxPayload.items[0];
    expect(aiInboxItem).toBeTruthy();
    if (!aiInboxItem) {
      throw new Error(
        "Expected the created AI thread in the unified inbox",
      );
    }
    await expect(
      bobPage
        .getByTestId("unified-inbox-list")
        .locator("a")
        .first(),
    ).toHaveAttribute(
      "href",
      `/app/chat/${aiInboxItem.surfaceId}`,
    );

    await bobPage.goto(
      `/app/chat/${aiInboxItem.surfaceId}`,
    );
    await expect(bobPage).toHaveURL(
      `/app/${aiInboxItem.domainId}`,
      { timeout: 20_000 },
    );
    await expect(aiComposer).toBeVisible();

    await signUp(alicePage, {
      name: "Inbox Alice",
      email: aliceEmail,
      password,
      handle: aliceHandle,
    });
    await verifyEmail(
      alicePage,
      request,
      aliceEmail,
    );
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
      .getByPlaceholder("@handle")
      .fill(`@${bobHandle}`);
    const peopleResults = alicePage.getByTestId(
      "people-search-results",
    );
    await expect(peopleResults).toContainText(
      "Inbox Bob",
      { timeout: 20_000 },
    );
    await expect(peopleResults).toContainText(
      `@${bobHandle}`,
    );
    await peopleResults
      .getByRole("button")
      .filter({ hasText: `@${bobHandle}` })
      .click();
    await alicePage
      .getByRole("button", {
        name: /начать чат|start chat/i,
      })
      .click();
    await expect(
      alicePage.getByTestId(
        "direct-chat-shell",
      ),
    ).toBeVisible({ timeout: 20_000 });

    const directText =
      "newer local-only preview";
    const directComposer =
      alicePage.getByPlaceholder(
        /сообщение этому человеку|message this person/i,
      );
    await directComposer.fill(directText);
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect(
      alicePage
        .getByTestId(
          "direct-message-human",
        )
        .filter({ hasText: directText }),
    ).toBeVisible({ timeout: 20_000 });

    const inbox =
      bobPage.getByTestId(
        "unified-inbox-list",
      );
    const directRow =
      inbox.getByTestId(
        "direct-conversation-row",
      );

    const directInboxResponse =
      await bobPage.request.get(
        `${apiBase}/v1/inbox?kind=DIRECT`,
        { headers: { origin: webOrigin } },
      );
    expect(directInboxResponse.ok()).toBe(true);
    const directInboxPayload =
      (await directInboxResponse.json()) as {
        items: Array<{
          surfaceId: string;
          domainId: string;
        }>;
      };
    const directInboxItem =
      directInboxPayload.items[0];
    expect(directInboxItem).toBeTruthy();
    if (!directInboxItem) {
      throw new Error(
        "Expected the Direct Chat in the unified inbox",
      );
    }

    // Durable sync makes the newer Direct surface lead the same mixed list.
    await expect(directRow).toBeVisible({
      timeout: 30_000,
    });
    await expect(directRow).toHaveAttribute(
      "href",
      `/app/chat/${directInboxItem.surfaceId}`,
    );
    await expect(
      inbox.locator("a").first(),
    ).toHaveAttribute(
      "data-testid",
      "direct-conversation-row",
    );

    // Bob has not decrypted this message yet, so the inbox must not receive
    // plaintext from the server and shows the safe local-cache fallback.
    await expect(directRow).toContainText(
      /зашифрованное сообщение|encrypted message/i,
    );
    await expect(directRow).not.toContainText(
      directText,
    );
    await expect(
      directRow.getByText("1", { exact: true }),
    ).toBeVisible();

    const bobMirrorPage =
      await bobContext.newPage();
    await bobMirrorPage.goto("/app");
    const mirrorDirectRow =
      bobMirrorPage
        .getByTestId("unified-inbox-list")
        .getByTestId("direct-conversation-row");
    await expect(mirrorDirectRow).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      mirrorDirectRow.getByText("1", {
        exact: true,
      }),
    ).toBeVisible();

    await directRow.click();
    await expect(
      bobPage
        .getByTestId(
          "direct-message-human",
        )
        .filter({ hasText: directText }),
    ).toBeVisible({ timeout: 20_000 });

    // Decryption persists protected local plaintext. Reopening the inbox may
    // now resolve the preview locally against authoritative message metadata.
    await bobPage.goto("/app");
    const reopenedRow =
      bobPage
        .getByTestId(
          "unified-inbox-list",
        )
        .getByTestId(
          "direct-conversation-row",
        );
    await expect(reopenedRow).toContainText(
      directText,
      { timeout: 20_000 },
    );

    // Read state is a durable user-scoped sync event, so another tab converges
    // without a reload.
    await expect(
      mirrorDirectRow.getByText("1", {
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 30_000 });

    // Miss one Direct event while offline and prove the reconnect path catches
    // up from durable Sync rather than relying on the realtime fast path.
    await bobContext.setOffline(true);
    const reconnectText =
      "offline reconnect preview";
    await directComposer.fill(reconnectText);
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({ hasText: reconnectText }),
    ).toBeVisible({ timeout: 20_000 });
    await bobContext.setOffline(false);

    await expect(reopenedRow).toContainText(
      /зашифрованное сообщение|encrypted message/i,
      { timeout: 30_000 },
    );
    await expect(reopenedRow).not.toContainText(
      reconnectText,
    );
    await expect(
      reopenedRow.getByText("1", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });

    // Filters operate on the same server-side inbox contract rather than on
    // two separately fetched lists.
    await bobPage
      .getByRole("radio", {
        name: /^ai$/i,
      })
      .click();
    await expect(
      bobPage.getByTestId(
        "direct-conversation-row",
      ),
    ).toHaveCount(0);

    await bobPage
      .getByRole("radio", {
        name: /все|all/i,
      })
      .click();
    const search =
      bobPage.getByRole("searchbox");
    await search.fill("Inbox Alice");
    await expect(
      bobPage.getByTestId(
        "direct-conversation-row",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      bobPage
        .getByTestId(
          "unified-inbox-list",
        )
        .locator("a"),
    ).toHaveCount(1);

    await bobMirrorPage.close();
    await aliceContext.close();
    await bobContext.close();
  });

  test("keeps AI inbox usable when Direct device bootstrap fails", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail(
      "e2e-inbox-bootstrap-isolation",
    );
    await signUp(page, {
      name: "Inbox Bootstrap Isolation",
      email,
      password: "correct-horse-battery",
    });
    await verifyEmail(page, request, email);

    const created = await page.request.post(
      `${apiBase}/v1/conversations`,
      {
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
        },
        data: {
          title: "AI survives Direct bootstrap failure",
        },
      },
    );
    expect(created.ok()).toBe(true);

    await page.route(
      "**/v1/direct-chats/devices",
      async (route) => {
        if (route.request().method() === "POST") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await page.goto("/app");
    await expect(
      page.getByRole("heading", {
        name: /сообщения|messages/i,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("unified-inbox-list")
        .getByText(
          "AI survives Direct bootstrap failure",
        ),
    ).toBeVisible();
  });

  test("loads the next unified inbox page in the browser", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail(
      "e2e-inbox-pagination",
    );
    await signUp(page, {
      name: "Inbox Pagination",
      email,
      password: "correct-horse-battery",
    });
    await verifyEmail(page, request, email);

    for (let index = 0; index < 51; index += 1) {
      const created = await page.request.post(
        `${apiBase}/v1/conversations`,
        {
          headers: {
            origin: webOrigin,
            "content-type": "application/json",
          },
          data: {
            title: `Paged conversation ${index}`,
          },
        },
      );
      expect(created.ok()).toBe(true);
    }

    await page.goto("/app");
    const list = page.getByTestId(
      "unified-inbox-list",
    );
    await expect(list.locator("a")).toHaveCount(
      50,
      { timeout: 20_000 },
    );
    await page
      .getByRole("button", {
        name: /загрузить ещё|load more/i,
      })
      .click();
    await expect(list.locator("a")).toHaveCount(
      51,
      { timeout: 20_000 },
    );
  });
});