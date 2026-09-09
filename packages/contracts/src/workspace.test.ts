import { describe, expect, it } from "vitest";
import { createTaskSchema, updateReminderSchema } from "./workspace.js";

describe("workspace public DTOs", () => {
  it("rejects owner and source authority fields", () => {
    const result = createTaskSchema.safeParse({
      title: "Buy milk",
      userId: "other-user",
      personalOwnerUserId: "other-user",
      scopeType: "PROJECT",
      sourceConversationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects delivered reminder status from clients", () => {
    const result = updateReminderSchema.safeParse({ status: "DELIVERED" });
    expect(result.success).toBe(false);
  });
});
