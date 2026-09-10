import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";

const password = "correct-horse-battery";
const tbankPassword = "local-dev-only-tbank-password";

test.describe("billing checkout", () => {
  test("PRO checkout stays pending after redirect and grants after a verified webhook", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("e2e-pay");
    await signUp(page, { name: "Ada", email, password });
    await verifyEmail(page, request, email);
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { name: /оплата|billing/i, level: 1 })).toBeVisible();

    const buyPro = page.locator("li").filter({ hasText: "Pro" }).getByRole("button", { name: /купить|buy/i });
    await buyPro.dblclick();
    await page.waitForURL(/\/payment\/mock/);
    await page.getByRole("link", { name: /вернуться в магазин|return to merchant/i }).click();
    await expect(page).toHaveURL(/\/payment\/result/);
    await expect(page.getByText(/ожидаем подтверждение|waiting for confirmation/i)).toBeVisible();

    const paymentId = new URL(page.url()).searchParams.get("paymentId");
    expect(paymentId).toBeTruthy();
    const paymentResponse = await page.request.get(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3101"}/v1/payments/${paymentId}`,
    );
    expect(paymentResponse.ok()).toBe(true);
    const payment = (await paymentResponse.json()) as {
      status: string;
      orderId: string;
      providerPaymentId: string;
    };
    expect(payment.status).toBe("PENDING");

    const fields = {
      TerminalKey: "MockTerminalKey",
      OrderId: payment.orderId,
      Success: true,
      Status: "CONFIRMED",
      PaymentId: payment.providerPaymentId,
      ErrorCode: "0",
      Amount: 99000,
    };
    const webhook = await request.post(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3101"}/webhooks/tbank/payments`,
      {
        data: { ...fields, Token: signSha256Token(fields, tbankPassword) },
      },
    );
    expect(webhook.status()).toBe(200);
    expect(await webhook.text()).toBe("OK");

    await page.reload();
    await expect(page.getByText(/оплачено|paid/i)).toBeVisible();
    await page.goto("/settings/billing");
    await expect(page.getByText(/действует до|active until/i)).toBeVisible();
  });

  test("top-up checkout stays pending after redirect and grants after a verified webhook", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("e2e-topup");
    await signUp(page, { name: "Ada", email, password });
    await verifyEmail(page, request, email);
    await page.goto("/settings/billing");
    await page.getByRole("button", { name: /оплатить|pay/i }).click();
    await page.waitForURL(/\/payment\/mock/);
    await page.getByRole("link", { name: /вернуться в магазин|return to merchant/i }).click();
    await expect(page).toHaveURL(/\/payment\/result/);
    await expect(page.getByText(/ожидаем подтверждение|waiting for confirmation/i)).toBeVisible();

    const paymentId = new URL(page.url()).searchParams.get("paymentId");
    expect(paymentId).toBeTruthy();
    const paymentResponse = await page.request.get(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3101"}/v1/payments/${paymentId}`,
    );
    expect(paymentResponse.ok()).toBe(true);
    const payment = (await paymentResponse.json()) as {
      status: string;
      orderId: string;
      providerPaymentId: string;
    };
    expect(payment.status).toBe("PENDING");

    const fields = {
      TerminalKey: "MockTerminalKey",
      OrderId: payment.orderId,
      Success: true,
      Status: "CONFIRMED",
      PaymentId: payment.providerPaymentId,
      ErrorCode: "0",
      Amount: 100000,
    };
    const webhook = await request.post(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3101"}/webhooks/tbank/payments`,
      {
        data: { ...fields, Token: signSha256Token(fields, tbankPassword) },
      },
    );
    expect(webhook.status()).toBe(200);
    expect(await webhook.text()).toBe("OK");

    await page.reload();
    await expect(page.getByText(/оплачено|paid/i)).toBeVisible();
    await page.goto("/settings/billing");
    await expect(page.getByText(/докупленный пакет|top-up/i)).toBeVisible();
  });
});

function signSha256Token(fields: Record<string, unknown>, secret: string): string {
  const pairs = Object.entries(fields)
    .filter(([key, value]) => key.toLowerCase() !== "token" && (typeof value !== "object" || value === null))
    .map(([key, value]) => ({ key, value: stringifyScalar(value) }))
    .concat([{ key: "Password", value: secret }]);
  pairs.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return createHash("sha256")
    .update(pairs.map((pair) => pair.value).join(""), "utf8")
    .digest("hex");
}

function stringifyScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}
