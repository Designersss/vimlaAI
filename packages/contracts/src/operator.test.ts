import { describe, expect, it } from "vitest";
import { createOperatorRunSchema, confirmOperatorRunSchema } from "./operator.js";

describe("operator contracts", () => {
  it("rejects owner and permission injection on run create", () => {
    expect(
      createOperatorRunSchema.safeParse({
        clientRequestId: "11111111-1111-4111-8111-111111111111",
        content: "create a task",
        userId: "other",
        permissions: ["*"],
      }).success,
    ).toBe(false);

    expect(
      confirmOperatorRunSchema.safeParse({
        confirmationToken: "token-token-token-token",
        userId: "other",
      }).success,
    ).toBe(false);
  });
});
