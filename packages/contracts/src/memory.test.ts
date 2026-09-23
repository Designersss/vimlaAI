import { describe, expect, it } from "vitest";
import {
  correctPersonalMemorySchema,
  createPersonalMemorySchema,
  listMemoriesQuerySchema,
  promoteE2eeMemorySchema,
} from "./memory.js";

describe("memory contracts", () => {
  it("accepts bounded personal memory and rejects authority injection", () => {
    expect(
      createPersonalMemorySchema.safeParse({
        type: "USER_PREFERENCE",
        slotKey: "answer style",
        content: "Prefers concise answers",
      }).success,
    ).toBe(true);
    expect(
      createPersonalMemorySchema.safeParse({
        type: "USER_PREFERENCE",
        slotKey: "answer style",
        content: "Prefers concise answers",
        userId: "forged-user",
      }).success,
    ).toBe(false);
    expect(
      createPersonalMemorySchema.safeParse({
        type: "PROJECT_FACT",
        slotKey: "project",
        content: "not a personal API type",
      }).success,
    ).toBe(false);
  });

  it("bounds content, slot keys, pagination, and correction payloads", () => {
    expect(
      createPersonalMemorySchema.safeParse({
        type: "USER_FACT",
        slotKey: "x".repeat(129),
        content: "value",
      }).success,
    ).toBe(false);
    expect(
      createPersonalMemorySchema.safeParse({
        type: "USER_FACT",
        slotKey: "fact",
        content: "x".repeat(4_001),
      }).success,
    ).toBe(false);
    expect(
      listMemoriesQuerySchema.parse({ limit: "100" }).limit,
    ).toBe(100);
    expect(
      listMemoriesQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      correctPersonalMemorySchema.safeParse({
        content: "corrected",
        scopeKind: "PROJECT",
      }).success,
    ).toBe(false);
  });

  it("requires explicit Direct Chat and message provenance for E2EE promotion", () => {
    expect(
      promoteE2eeMemorySchema.safeParse({
        directConversationId:
          "11111111-1111-4111-8111-111111111111",
        sourceMessageId:
          "22222222-2222-4222-8222-222222222222",
        type: "USER_FACT",
        slotKey: "coffee",
        content: "Prefers black coffee",
      }).success,
    ).toBe(true);
    expect(
      promoteE2eeMemorySchema.safeParse({
        directConversationId: "not-a-uuid",
        sourceMessageId:
          "22222222-2222-4222-8222-222222222222",
        type: "USER_FACT",
        slotKey: "coffee",
        content: "Prefers black coffee",
      }).success,
    ).toBe(false);
  });
});
