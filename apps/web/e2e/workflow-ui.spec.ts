import { expect, test } from "@playwright/test";
import {
  apiBase,
  purchasePro,
  signUp,
  startNewConversation,
  uniqueEmail,
  verifyEmail,
  webOrigin,
} from "./helpers";
import { assertNoDocumentOverflow } from "./responsive-helpers";

test("workflow lane stays usable with the chat composer across desktop and mobile", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  const email = uniqueEmail("e2e-workflow-ui");
  await signUp(page, {
    name: "Workflow UI",
    email,
    password: "correct-horse-battery",
  });
  await verifyEmail(page, request, email);
  await purchasePro(page);
  await startNewConversation(page);

  const conversationId = new URL(page.url()).pathname.split("/").at(-1);
  expect(conversationId).toBeTruthy();

  const composer = page.getByPlaceholder(/сообщение для vimla|message vimla/i);
  await composer.fill("Workflow source message");
  await page.getByRole("button", { name: /отправить|send/i }).click();
  await expect(page.getByText("Hello from Vimla")).toBeVisible({
    timeout: 20_000,
  });

  const conversationResponse = await page.request.get(
    `${apiBase}/v1/conversations/${conversationId}`,
    {
      headers: { origin: webOrigin },
    },
  );
  expect(conversationResponse.status()).toBe(200);
  const conversation = (await conversationResponse.json()) as {
    messages: Array<{ id: string; role: "USER" | "ASSISTANT"; content: string }>;
  };
  const source = [...conversation.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "USER" && message.content === "Workflow source message",
    );
  expect(source?.id).toBeTruthy();

  const planResponse = await page.request.post(
    `${apiBase}/v1/execution-plans`,
    {
      headers: {
        origin: webOrigin,
        "content-type": "application/json",
      },
      data: {
        messageId: source?.id,
        plan: {
          schemaVersion: 1,
          goal: "Create a reminder after explicit confirmation",
          maxParallelism: 1,
          invocations: [
            {
              id: "remind",
              purpose: "Create a reminder",
              target: { kind: "VIMLA" },
              outputs: [],
              acceptanceCriteria: [],
              riskClass: "INTERNAL_WRITE",
              approvalPolicy: "USER_CONFIRMATION",
              failurePolicy: "FAIL_PLAN",
              joinPolicy: "ALL_REQUIRED",
            },
          ],
          dependencies: [],
        },
      },
    },
  );
  expect(planResponse.status()).toBe(201);

  await page.reload();

  const lane = page.getByTestId("workflow-lane");
  const card = page.getByTestId("workflow-card");
  await expect(lane).toBeVisible();
  await expect(card).toContainText(
    /create a reminder after explicit confirmation/i,
  );
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();

  await card.getByRole("button", { name: /запустить|start/i }).click();
  await expect(
    card.getByRole("button", { name: /подтвердить|approve/i }),
  ).toBeVisible();
  await expect(
    card.getByText(/нужно подтверждение|needs approval/i),
  ).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await assertNoDocumentOverflow(page);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();

    const responsiveCard = page.getByTestId("workflow-card");
    const responsiveComposer = page.getByPlaceholder(
      /сообщение для vimla|message vimla/i,
    );
    const approve = responsiveCard.getByRole("button", {
      name: /подтвердить|approve/i,
    });
    await expect(responsiveCard).toBeVisible();
    await expect(responsiveComposer).toBeVisible();
    await expect(responsiveComposer).toBeEnabled();
    await expect(approve).toBeVisible();
    await approve.focus();
    await expect(approve).toBeFocused();
    await assertNoDocumentOverflow(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();

  const approvalCard = page.getByTestId("workflow-card").filter({
    hasText: /create a reminder after explicit confirmation/i,
  });
  const approve = approvalCard.getByRole("button", {
    name: /подтвердить|approve/i,
  });
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();

  const stop = approvalCard.getByRole("button", {
    name: /остановить|stop/i,
  });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(approvalCard).toContainText(
    /остановлен|stopped|завершён|completed/i,
  );
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await assertNoDocumentOverflow(page);
  await assertNoDocumentOverflow(page);
});
