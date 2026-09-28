import { expect, test } from "@playwright/test";
import {
  purchasePro,
  signUp,
  uniqueEmail,
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
        name: "Nikita Cross Browser",
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
      let secondaryPhase:
        | "hide-older"
        | "newest-only"
        | "passthrough" = "hide-older";

      await nikitaPage.route(
        "**/v1/direct-chats/*/messages?**",
        async (route) => {
          if (
            holdPrimaryReceive &&
            route.request().method() === "GET"
          ) {
            holdPrimaryReceive = false;
            const response = await route.fetch();
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
          if (route.request().method() !== "GET") {
            await route.continue();
            return;
          }
          if (secondaryPhase === "passthrough") {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          const payload = (await response.json()) as {
            items?: unknown[];
            nextCursor?: string | null;
          };
          const items = Array.isArray(payload.items)
            ? payload.items
            : [];
          if (secondaryPhase === "hide-older") {
            secondaryPhase = "newest-only";
            markOlderHidden();
            await route.fulfill({
              response,
              json: {
                ...payload,
                items: items.slice(1),
              },
            });
            return;
          }
          await route.fulfill({
            response,
            json: {
              ...payload,
              items: items.slice(0, 1),
            },
          });
        },
      );

      const delayedOlderText =
        "receiver delayed older ratchet message";
      const concurrentNewerText =
        "receiver concurrent newer ratchet message";
      await firstComposer.fill(delayedOlderText);
      await alicePage
        .getByTestId("chat-composer-send")
        .click();
      await Promise.all([
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

      secondaryPhase = "passthrough";
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
});
