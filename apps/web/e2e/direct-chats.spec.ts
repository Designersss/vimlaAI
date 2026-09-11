import { expect, test } from "@playwright/test";
import { purchasePro, signUp, uniqueEmail, verifyEmail, webOrigin, apiBase } from "./helpers";
import { assertNoDocumentOverflow, assertReachable } from "./responsive-helpers";

test.describe("Secure Direct Chats", () => {
  test("two users exchange E2EE messages and invoke @Vimla in-thread", async ({ browser, request }) => {
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

    const composer = alicePage.getByPlaceholder(/сообщение этому человеку|message this person/i);
    await composer.fill("hello from alice");
    await alicePage.getByRole("button", { name: /отправить|send/i }).click();
    await expect(alicePage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    await nikitaPage.goto("/app");
    await expect(nikitaPage.getByRole("heading", { name: /сообщения|messages/i })).toBeVisible();
    await nikitaPage.getByRole("radio", { name: /личные|direct/i }).click();
    await expect(nikitaPage.getByRole("button", { name: /^Alice$/i })).toBeVisible({ timeout: 20_000 });
    await nikitaPage.getByRole("button", { name: /^Alice$/i }).click();
    await expect(nikitaPage.getByTestId("direct-chat-shell")).toBeVisible({ timeout: 20_000 });
    await expect(nikitaPage.getByTestId("direct-message-human").filter({ hasText: "hello from alice" })).toBeVisible({
      timeout: 20_000,
    });

    await alicePage.getByRole("button", { name: /◆ @vimla/i }).click();
    await composer.fill("@Vimla, кто победил в гран-при 2026?");
    await alicePage.getByRole("button", { name: /отправить|send/i }).click();
    await expect(alicePage.getByTestId("direct-message-invoke")).toBeVisible({ timeout: 20_000 });
    await expect(alicePage.getByTestId("direct-message-response")).toBeVisible({ timeout: 20_000 });

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await alicePage.setViewportSize(viewport);
      await expect(alicePage.getByTestId("direct-chat-shell")).toBeVisible();
      await assertReachable(alicePage, alicePage.getByRole("button", { name: /отправить|send/i }));
      await assertNoDocumentOverflow(alicePage);
    }

    await aliceContext.close();
    await nikitaContext.close();
  });
});
