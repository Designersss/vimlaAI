import { describe, expect, it } from "vitest";
import { canonicalTokenString, signTBankToken, verifyTBankToken } from "./tbank-token.js";

describe("T-Bank Token signer", () => {
  it("matches the official Init fixture from the Dev Portal", () => {
    const fields = {
      TerminalKey: "MerchantTerminalKey",
      Amount: 19200,
      OrderId: "00000",
      Description: "Подарочная карта на 1000 рублей",
      DATA: { Phone: "+71234567890", Email: "a@test.com" },
      Receipt: {
        Email: "a@test.ru",
        Items: [{ Amount: 10000 }],
      },
    };

    expect(canonicalTokenString(fields, "11111111111111")).toBe(
      "19200Подарочная карта на 1000 рублей0000011111111111111MerchantTerminalKey",
    );
    expect(signTBankToken(fields, "11111111111111")).toBe(
      "72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2",
    );
  });

  it("matches the official notification fixture and ignores nested Data", () => {
    const fields = {
      TerminalKey: "1234567890DEMO",
      OrderId: "000000",
      Success: true,
      Status: "AUTHORIZED",
      PaymentId: "0000000",
      ErrorCode: "0",
      Amount: 1111,
      CardId: "000000",
      Pan: "200000******0000",
      ExpDate: "1111",
      RebillId: "000000",
      Data: { description: "should-be-excluded" },
      Token: "should-be-excluded",
    };

    expect(canonicalTokenString(fields, "11111111111")).toBe(
      "111100000001111000000200000******0000111111111110000000000000AUTHORIZEDtrue1234567890DEMO",
    );
    expect(signTBankToken(fields, "11111111111")).toBe(
      "1c0964277d0213349243065a0d5b838b8e90d2d25f740d0f2767836e710e80c8",
    );
    expect(verifyTBankToken(fields, "11111111111", signTBankToken(fields, "11111111111"))).toBe(
      true,
    );
  });

  it("rejects a single-field mutation", () => {
    const fields = {
      TerminalKey: "MerchantTerminalKey",
      Amount: 19200,
      OrderId: "00000",
      Description: "Подарочная карта на 1000 рублей",
    };
    const token = signTBankToken(fields, "11111111111111");
    expect(verifyTBankToken({ ...fields, Amount: 19201 }, "11111111111111", token)).toBe(false);
  });
});
