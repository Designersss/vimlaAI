import { describe, expect, it } from "vitest";
import { createOperatorRunSchema, confirmOperatorRunSchema, operatorActionCardSchema } from "./operator.js";

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

  it("accepts semantic navigation and rejects Web href fields on action cards", () => {
    const base = {
      kind: "task" as const,
      operation: "created" as const,
      title: "Task",
      detail: null,
      status: "success" as const,
      navigationTarget: { version: 1 as const, kind: "TASKS" as const },
    };
    expect(operatorActionCardSchema.safeParse(base).success).toBe(true);
    expect(
      operatorActionCardSchema.safeParse({
        ...base,
        hrefPath: "/work/tasks",
      }).success,
    ).toBe(false);
  });

  it("requires an encrypted source message for Direct Chat runs", () => {
    const base = {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      content: "@vimla help",
      invocationScope: "DIRECT_CHAT" as const,
      directConversationId: "22222222-2222-4222-8222-222222222222",
    };
    expect(createOperatorRunSchema.safeParse(base).success).toBe(false);
    expect(
      createOperatorRunSchema.safeParse({
        ...base,
        directSourceMessageId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(true);
    expect(
      createOperatorRunSchema.safeParse({
        clientRequestId: base.clientRequestId,
        content: base.content,
        invocationScope: "PERSONAL",
        directSourceMessageId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(false);
  });
});
