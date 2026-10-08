import { expect, test } from "@playwright/test";
import {
  purchasePro,
  signUp,
  uniqueEmail,
  uniqueHandle,
  verifyEmail,
} from "./helpers";

test.describe("Direct Chat cross-browser coordination", () => {
  test("serializes same-device concurrent sends and peer decrypts both", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail("e2e-direct-xbrowser-alice");
    const nikitaEmail = uniqueEmail("e2e-direct-xbrowser-nikita");
    const nikitaHandle = uniqueHandle("xbpeer");

    const aliceContext = await browser.newContext();
    const nikitaContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const nikitaPage = await nikitaContext.newPage();

    try {
      await signUp(alicePage, {
        name: "Alice Cross Browser",
        email: aliceEmail,
        password,
      });
      await verifyEmail(alicePage, request, aliceEmail);
      await purchasePro(alicePage);

      await signUp(nikitaPage, {
        name: "Cross Browser Peer",
        email: nikitaEmail,
        password,
        handle: nikitaHandle,
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
        .getByPlaceholder("@handle")
        .fill(`@${nikitaHandle}`);
      const nikitaResult = alicePage
        .getByTestId("people-search-results")
        .getByRole("button")
        .filter({ hasText: `@${nikitaHandle}` });
      await expect(nikitaResult).toHaveCount(1, {
        timeout: 20_000,
      });
      await nikitaResult.click();
      await alicePage
        .getByRole("button", {
          name: /начать чат|start chat/i,
        })
        .click();
      await expect(
        alicePage.getByTestId("direct-chat-shell"),
      ).toBeVisible({ timeout: 20_000 });
      const directUrl = alicePage.url();

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

      const aliceSecondPage =
        await aliceContext.newPage();
      await aliceSecondPage.goto(directUrl);
      await expect(
        aliceSecondPage.getByTestId(
          "direct-chat-shell",
        ),
      ).toBeVisible({ timeout: 20_000 });

      const firstText =
        "cross-browser concurrent send A";
      const secondText =
        "cross-browser concurrent send B";
      const firstComposer =
        alicePage.getByPlaceholder(
          /сообщение этому человеку|message this person/i,
        );
      const secondComposer =
        aliceSecondPage.getByPlaceholder(
          /сообщение этому человеку|message this person/i,
        );
      await firstComposer.fill(firstText);
      await secondComposer.fill(secondText);

      await Promise.all([
        alicePage
          .getByTestId("chat-composer-send")
          .click(),
        aliceSecondPage
          .getByTestId("chat-composer-send")
          .click(),
      ]);

      for (const text of [firstText, secondText]) {
        await expect(
          nikitaPage
            .getByTestId("direct-message-human")
            .filter({ hasText: text }),
        ).toHaveCount(1, { timeout: 20_000 });
      }
      await expect(
        nikitaPage.getByTestId(
          "direct-message-undecryptable",
        ),
      ).toHaveCount(0);

      const siblingRaceText =
        "same-device realtime before sender response";
      let releaseHeldResponse!: () => void;
      let markCommitted!: () => void;
      let markResponseFulfilled!: () => void;
      const heldResponse = new Promise<void>(
        (resolve) => {
          releaseHeldResponse = resolve;
        },
      );
      const serverCommitted = new Promise<void>(
        (resolve) => {
          markCommitted = resolve;
        },
      );
      const responseFulfilled = new Promise<void>(
        (resolve) => {
          markResponseFulfilled = resolve;
        },
      );
      let holdNextHumanSend = true;
      await aliceSecondPage.route(
        "**/v1/direct-chats/*/messages",
        async (route) => {
          const body =
            route.request().method() === "POST"
              ? (route.request().postDataJSON() as {
                  kind?: string;
                } | null)
              : null;
          if (
            holdNextHumanSend &&
            body?.kind === "HUMAN"
          ) {
            holdNextHumanSend = false;
            const response = await route.fetch();
            markCommitted();
            await heldResponse;
            await route.fulfill({ response });
            markResponseFulfilled();
            return;
          }
          await route.continue();
        },
      );

      await secondComposer.fill(siblingRaceText);
      await aliceSecondPage
        .getByTestId("chat-composer-send")
        .click();
      await serverCommitted;

      await expect(
        alicePage
          .getByTestId("direct-message-human")
          .filter({ hasText: siblingRaceText }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        alicePage.getByTestId(
          "direct-message-undecryptable",
        ),
      ).toHaveCount(0);

      releaseHeldResponse();
      await responseFulfilled;
      await aliceSecondPage.unroute(
        "**/v1/direct-chats/*/messages",
      );
      await expect(
        nikitaPage
          .getByTestId("direct-message-human")
          .filter({ hasText: siblingRaceText }),
      ).toHaveCount(1, { timeout: 20_000 });

      const nikitaSecondPage =
        await nikitaContext.newPage();
      await nikitaSecondPage.goto(nikitaPage.url());
      await expect(
        nikitaSecondPage.getByTestId(
          "direct-chat-shell",
        ),
      ).toBeVisible({ timeout: 20_000 });

      let releaseOlderReceive!: () => void;
      let markOlderReceiveHeld!: () => void;
      let markOlderHidden!: () => void;
      const olderReceiveRelease = new Promise<void>(
        (resolve) => {
          releaseOlderReceive = resolve;
        },
      );
      const olderReceiveHeld = new Promise<void>(
        (resolve) => {
          markOlderReceiveHeld = resolve;
        },
      );
      const olderHidden = new Promise<void>(
        (resolve) => {
          markOlderHidden = resolve;
        },
      );
      let holdPrimaryReceive = true;
      let olderMessageId: string | null = null;
      let olderHiddenMarked = false;
      let olderSendCommitted: Promise<void> | null = null;
      let secondaryPassthrough = false;

      await nikitaPage.route(
        "**/v1/direct-chats/*/messages?**",
        async (route) => {
          if (
            holdPrimaryReceive &&
            route.request().method() === "GET" &&
            olderSendCommitted
          ) {
            await olderSendCommitted;
            if (!holdPrimaryReceive) {
              await route.continue();
              return;
            }
            const response = await route.fetch();
            const payload = (await response.json()) as {
              items?: Array<{ id?: unknown }>;
            };
            const containsOlder =
              typeof olderMessageId === "string" &&
              Array.isArray(payload.items) &&
              payload.items.some(
                (item) => item.id === olderMessageId,
              );
            if (!containsOlder) {
              await route.fulfill({ response });
              return;
            }
            holdPrimaryReceive = false;
            markOlderReceiveHeld();
            await olderReceiveRelease;
            await route.fulfill({ response });
            return;
          }
          await route.continue();
        },
      );
      await nikitaSecondPage.route(
        "**/v1/direct-chats/*/messages?**",
        async (route) => {
          if (
            route.request().method() !== "GET" ||
            secondaryPassthrough ||
            !olderSendCommitted
          ) {
            await route.continue();
            return;
          }
          await olderSendCommitted;
          const response = await route.fetch();
          const payload = (await response.json()) as {
            items?: Array<{ id?: unknown }>;
            nextCursor?: string | null;
          };
          const items = Array.isArray(payload.items)
            ? payload.items
            : [];
          const filtered =
            typeof olderMessageId === "string"
              ? items.filter(
                  (item) =>
                    item.id !== olderMessageId,
                )
              : items;
          if (
            !olderHiddenMarked &&
            filtered.length !== items.length
          ) {
            olderHiddenMarked = true;
            markOlderHidden();
          }
          await route.fulfill({
            response,
            json: {
              ...payload,
              items: filtered,
            },
          });
        },
      );

      const delayedOlderText =
        "receiver delayed older ratchet message";
      const concurrentNewerText =
        "receiver concurrent newer ratchet message";
      await firstComposer.fill(delayedOlderText);
      olderSendCommitted = alicePage
        .waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            /\/v1\/direct-chats\/[^/]+\/messages$/.test(
              new URL(response.url()).pathname,
            ) &&
            response.ok(),
        )
        .then(async (response) => {
          const payload = (await response.json()) as {
            id?: unknown;
          };
          if (typeof payload.id !== "string") {
            throw new Error(
              "Committed delayed message id is missing",
            );
          }
          olderMessageId = payload.id;
        });
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await Promise.all([
        olderSendCommitted,
        olderReceiveHeld,
        olderHidden,
      ]);

      await firstComposer.fill(concurrentNewerText);
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await expect(
        nikitaSecondPage
          .getByTestId("direct-message-human")
          .filter({ hasText: concurrentNewerText }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        nikitaSecondPage
          .getByTestId("direct-message-human")
          .filter({ hasText: delayedOlderText }),
      ).toHaveCount(0);

      secondaryPassthrough = true;
      releaseOlderReceive();
      await expect(
        nikitaPage
          .getByTestId("direct-message-human")
          .filter({ hasText: delayedOlderText }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        nikitaPage
          .getByTestId("direct-message-human")
          .filter({ hasText: concurrentNewerText }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        nikitaPage.getByTestId(
          "direct-message-undecryptable",
        ),
      ).toHaveCount(0);
      await expect(
        nikitaSecondPage.getByTestId(
          "direct-message-undecryptable",
        ),
      ).toHaveCount(0);
      await nikitaPage.unroute(
        "**/v1/direct-chats/*/messages?**",
      );
      await nikitaSecondPage.unroute(
        "**/v1/direct-chats/*/messages?**",
      );
      await nikitaSecondPage.close();

      await aliceSecondPage.close();
    } finally {
      await aliceContext.close();
      await nikitaContext.close();
    }
  });
  test("resolves source-authenticated replies on multiple enrolled devices", async ({ browser, request }) => {
    test.setTimeout(150_000);
    const password = "correct-horse-battery";
    const aliceEmail = uniqueEmail("e2e-multidevice-reply-alice");
    const bobEmail = uniqueEmail("e2e-multidevice-reply-bob");
    const bobHandle = uniqueHandle("replypeer");
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    let secondaryContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    try {
      const alicePage = await aliceContext.newPage();
      const bobPage = await bobContext.newPage();
      await signUp(alicePage, { name: "Alice Replies", email: aliceEmail, password });
      await verifyEmail(alicePage, request, aliceEmail);
      await purchasePro(alicePage);
      await signUp(bobPage, { name: "Bob Replies", email: bobEmail, password, handle: bobHandle });
      await verifyEmail(bobPage, request, bobEmail);
      await purchasePro(bobPage);
      await alicePage.goto("/app");
      await alicePage.getByRole("button", { name: /новый личный чат|new direct chat/i }).click();
      await alicePage.getByPlaceholder("@handle").fill(`@${bobHandle}`);
      const person = alicePage.getByTestId("people-search-results")
        .getByRole("button").filter({ hasText: `@${bobHandle}` });
      await expect(person).toBeVisible({ timeout: 20_000 });
      await person.click();
      await alicePage.getByRole("button", { name: /начать чат|start chat/i }).click();
      await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
      const url = alicePage.url();

      await bobPage.goto(url);
      await expect(bobPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
      secondaryContext = await browser.newContext({ storageState: await bobContext.storageState() });
      const bobSecondaryPage = await secondaryContext.newPage();
      await bobSecondaryPage.goto(url);
      await expect(bobSecondaryPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });

      const sourceText = "multi-device cryptographic reply original";
      await alicePage.getByPlaceholder(/сообщение этому человеку|message this person/i).fill(sourceText);
      await alicePage.getByTestId("chat-composer-send").click();
      for (const page of [bobPage, bobSecondaryPage]) {
        await expect(page.getByTestId("direct-message-row")
          .filter({ hasText: sourceText })).toBeVisible({ timeout: 20_000 });
      }
      await bobSecondaryPage.getByTestId("direct-message-row")
        .filter({ hasText: sourceText })
        .getByTestId("direct-message-reply-action").click();
      const responseText = "reply authored from second Bob crypto device";
      await bobSecondaryPage.getByPlaceholder(/сообщение этому человеку|message this person/i).fill(responseText);
      await bobSecondaryPage.getByTestId("chat-composer-send").click();
      for (const page of [alicePage, bobPage, bobSecondaryPage]) {
        const reply = page.getByTestId("direct-message-row")
          .filter({ hasText: responseText });
        await expect(reply).toBeVisible({ timeout: 20_000 });
        await expect(reply.getByTestId("direct-reply-context"))
          .toContainText(sourceText);
      }
      await bobSecondaryPage.reload();
      await expect(bobSecondaryPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
      await expect(bobSecondaryPage.getByTestId("direct-message-row")
        .filter({ hasText: responseText })
        .getByTestId("direct-reply-context"))
        .toContainText(sourceText, { timeout: 20_000 });
    } finally {
      await secondaryContext?.close();
      await aliceContext.close();
      await bobContext.close();
    }
  });

});
