import { describe, expect, it } from "vitest";
import {
  correctPersonalMemorySchema,
  createPersonalMemorySchema,
  createProjectMemorySchema,
  listMemoriesQuerySchema,
  memoryExtractionModelOutputSchema,
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

  it("requires explicit sensitivity for automatic extraction candidates", () => {
    expect(
      memoryExtractionModelOutputSchema.safeParse({
        candidates: [
          {
            type: "USER_PREFERENCE",
            slotKey: "answer style",
            content: "Prefers concise answers",
            confidence: 0.9,
            sensitivity: "NORMAL",
            transient: false,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      memoryExtractionModelOutputSchema.safeParse({
        candidates: [
          {
            type: "USER_PREFERENCE",
            slotKey: "answer style",
            content: "Prefers concise answers",
            confidence: 0.9,
            transient: false,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only project-scoped memory types for explicit project writes", () => {
    expect(
      createProjectMemorySchema.safeParse({
        type: "PROJECT_DECISION",
        slotKey: "launch",
        content: "Launch in October",
      }).success,
    ).toBe(true);
    expect(
      createProjectMemorySchema.safeParse({
        type: "USER_PREFERENCE",
        slotKey: "theme",
        content: "Dark",
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
