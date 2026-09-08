import { describe, expect, it } from "vitest";
import { rubToMicroRub } from "./money.js";
import { signTBankToken } from "./tbank-token.js";
import {
  MockTBankTransport,
  TBankPaymentProvider,
  verifyTBankNotification,
} from "./tbank-provider.js";

const password = "11111111111111";
const terminalKey = "MerchantTerminalKey";

function provider(transport = new MockTBankTransport()): TBankPaymentProvider {
  return new TBankPaymentProvider(
    {
      terminalKey,
      password,
      apiBaseUrl: "https://rest-api-test.tinkoff.ru",
      fiscalization: { enabled: false },
    },
    transport,
  );
}

describe("TBankPaymentProvider", () => {
  it("inits a hosted checkout without creating a second order for the same OrderId", async () => {
    const transport = new MockTBankTransport();
    const tbank = provider(transport);
    const first = await tbank.createHostedCheckout({
      orderId: "order-1",
      amountMicroRub: rubToMicroRub(150n),
      description: "Vimla PRO",
      language: "ru",
      notificationUrl: "https://api.example/webhooks/tbank/payments",
      successUrl: "https://app.example/payment/result",
      failUrl: "https://app.example/payment/result",
    });
    const second = await tbank.createHostedCheckout({
      orderId: "order-1",
      amountMicroRub: rubToMicroRub(150n),
      description: "Vimla PRO",
      language: "ru",
      notificationUrl: "https://api.example/webhooks/tbank/payments",
      successUrl: "https://app.example/payment/result",
      failUrl: "https://app.example/payment/result",
    });
    expect(first.providerPaymentId).toBe(second.providerPaymentId);
    expect(new Set(transport.inits.map((init) => init.OrderId)).size).toBe(1);
  });

  it("recovers an ambiguous Init through CheckOrder instead of a new order", async () => {
    const transport = new MockTBankTransport();
    transport.failNextInit = true;
    const tbank = provider(transport);
    const checkout = await tbank.createHostedCheckout({
      orderId: "order-amb",
      amountMicroRub: rubToMicroRub(150n),
      description: "Vimla PRO",
      language: "ru",
      notificationUrl: "https://api.example/webhooks/tbank/payments",
      successUrl: "https://app.example/payment/result",
      failUrl: "https://app.example/payment/result",
    });
    expect(checkout.providerPaymentId.length).toBeGreaterThan(0);
    expect(transport.inits).toHaveLength(1);
  });

  it("accepts a valid notification and rejects a single-field mutation", () => {
    const fields = {
      TerminalKey: terminalKey,
      OrderId: "order-1",
      Success: true,
      Status: "CONFIRMED",
      PaymentId: "123",
      ErrorCode: "0",
      Amount: 15000,
    };
    const valid = { ...fields, Token: signTBankToken(fields, password) };
    const verified = verifyTBankNotification(valid, terminalKey, password);
    expect(verified.status).toBe("CONFIRMED");
    expect(verified.amountMicroRub).toBe(rubToMicroRub(150n));

    expect(() =>
      verifyTBankNotification({ ...valid, Amount: 15001 }, terminalKey, password),
    ).toThrow(/Invalid payment notification/);
  });

  it("excludes nested Receipt from signature verification", () => {
    const fields = {
      TerminalKey: terminalKey,
      OrderId: "order-1",
      Success: true,
      Status: "CONFIRMED",
      PaymentId: "123",
      Amount: 15000,
      Receipt: { Items: [{ Amount: 1 }] },
    };
    const token = signTBankToken({ ...fields, Receipt: { Items: [{ Amount: 999 }] } }, password);
    expect(
      verifyTBankNotification({ ...fields, Token: token }, terminalKey, password).status,
    ).toBe("CONFIRMED");
  });
});
