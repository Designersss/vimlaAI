import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("Secure Direct Chats", () => {
  test("two users exchange E2EE messages and invoke @Vimla with structured mentions", async ({ browser, request }) => {
    test.setTimeout(180_000);
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
    const persistentList = await aliceList.elementHandle();

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

    await composer.fill("hello from alice");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    await nikitaPage.goto("/app");
    await expect(nikitaPage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await nikitaPage.getByRole("radio", { name: /личные|direct/i }).click();
    await expect(nikitaPage.getByTestId("direct-conversation-row")).toBeVisible({ timeout: 20_000 });
    await nikitaPage.getByTestId("direct-conversation-row").click();
    await expect(nikitaPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    await expect(alicePage.getByTestId("direct-mention-vimla")).toHaveCount(0);
    await composer.fill("@vimla");
    await expect(alicePage.getByTestId("composer-mention-highlight")).toHaveText("@vimla", { timeout: 20_000 });
    await composer.fill("@vimla кто победил в гран-при 2026?");
    await alicePage.getByTestId("chat-composer-send").click();
    await expect(alicePage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });
    await expect(alicePage.getByTestId("direct-message-response")).toBeVisible({ timeout: 20_000 });

    await nikitaPage.reload();
    await expect(nikitaPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });

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
        expect(await persistentList?.evaluate((el) => el.isConnected)).toBe(true);
      } else {
        await expect(aliceList).toBeVisible();
      }
    }

    // A fresh browser has the authenticated session but no IndexedDB device.
    // The persistent list and deep-linked detail must share one device setup.
    const coldContext = await browser.newContext({ storageState: await aliceContext.storageState() });
    const coldPage = await coldContext.newPage();
    let registrations = 0;
    coldPage.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url() === `${apiBase}/v1/direct-chats/devices`) {
        registrations += 1;
      }
    });
    await coldPage.goto(directUrl);
    await expect(coldPage.getByTestId("direct-chat-shell")).toBeVisible();
    await expect(coldPage.getByTestId("direct-conversation-row")).toBeVisible();
    expect(registrations).toBe(1);
    await coldContext.close();

    await aliceContext.close();
    await nikitaContext.close();
  });
});
