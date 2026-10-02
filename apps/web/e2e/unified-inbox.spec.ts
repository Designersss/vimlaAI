import {
  expect,
  test,
} from "@playwright/test";
import {
  apiBase,
  purchasePro,
  signUp,
  uniqueEmail,
  verifyEmail,
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
    const aliceEmail = uniqueEmail(
      "e2e-inbox-alice",
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
      .getByLabel(
        /email участника|participant email/i,
      )
      .fill(bobEmail);
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

    // Durable sync makes the newer Direct surface lead the same mixed list.
    await expect(directRow).toBeVisible({
      timeout: 30_000,
    });
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

    await aliceContext.close();
    await bobContext.close();
  });
});
