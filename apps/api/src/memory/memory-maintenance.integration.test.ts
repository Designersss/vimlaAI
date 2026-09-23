import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type { SemanticPlannerModel } from "@vimla/orchestration";
import { loadApiConfig } from "@vimla/config/server";
import {
  createPrismaClient,
  type PrismaClient,
} from "@vimla/database";
import type { ApiRuntimeConfig } from "../config/api-config.js";
import type { PrismaService } from "../persistence/prisma.service.js";
import { MemoryFacade } from "./memory.facade.js";
import { MemoryMaintenanceService } from "./memory-maintenance.service.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is required");
}

let db: PrismaClient;
let config: ApiRuntimeConfig;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: label,
      email: `${id}@example.test`,
      emailVerified: true,
    },
  });
  return id;
}

async function createConversation(
  userId: string,
): Promise<string> {
  return (
    await db.conversation.create({
      data: {
        userId,
        kind: "CHAT",
      },
    })
  ).id;
}

async function createMessage(input: {
  conversationId: string;
  role?: "USER" | "ASSISTANT";
  content: string;
}) {
  return db.message.create({
    data: {
      conversationId: input.conversationId,
      role: input.role ?? "USER",
      status: "COMPLETE",
      content: input.content,
    },
  });
}

function prismaService(): PrismaService {
  return { client: db } as PrismaService;
}

describe("memory maintenance runtime", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.DATABASE_URL = url;
    process.env.REDIS_URL =
      process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL =
      "http://localhost:3001";
    process.env.MEMORY_ENABLED = "true";
    process.env.DIRECT_CHATS_ENABLED = "true";

    config = loadApiConfig(process.env);
    db = createPrismaClient(url);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("extracts durable memory once per source version and records a completed receipt", async () => {
    const userId = await createUser("runtime-extraction");
    const conversationId =
      await createConversation(userId);
    const source = await createMessage({
      conversationId,
      content:
        "Please remember runtime: I prefer concise technical answers.",
    });

    let modelCalls = 0;
    const model: SemanticPlannerModel = {
      complete: async ({ prompt }) => {
        modelCalls += 1;
        if (prompt.startsWith("You extract durable personal memory")) {
          return JSON.stringify({
            candidates: [
              {
                type: "USER_PREFERENCE",
                slotKey: "answer style",
                content: "Prefers concise technical answers",
                confidence: 0.95,
                sensitivity: "NORMAL",
                transient: false,
              },
            ],
          });
        }
        return JSON.stringify({
          summary: "Conversation summary",
        });
      },
    };

    const prisma = prismaService();
    const facade = new MemoryFacade(prisma, config);
    const maintenance = new MemoryMaintenanceService(
      prisma,
      facade,
      config,
      model,
    );

    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-extraction-1",
    });
    const memory = await db.memoryItem.findFirstOrThrow({
      where: {
        ownerUserId: userId,
        slotKey: "answer style",
      },
      include: { sourceRefs: true },
    });
    expect(memory.origin).toBe("AUTO_EXTRACTION");
    expect(memory.content).toBe(
      "Prefers concise technical answers",
    );
    expect(memory.sourceRefs).toHaveLength(1);
    expect(memory.sourceRefs[0]).toMatchObject({
      sourceType: "MESSAGE",
      sourceId: source.id,
      sourceVersion: source.updatedAt.toISOString(),
      sourceScopeKind: "CONVERSATION",
      sourceScopeId: conversationId,
    });
    expect(
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          sourceType_sourceId_sourceVersion: {
            sourceType: "MESSAGE",
            sourceId: source.id,
            sourceVersion: source.updatedAt.toISOString(),
          },
        },
      }),
    ).toMatchObject({
      status: "COMPLETED",
      candidateCount: 1,
    });
    expect(modelCalls).toBe(1);

    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-extraction-replay",
    });
    expect(modelCalls).toBe(1);
    expect(
      await db.memoryItem.count({
        where: {
          ownerUserId: userId,
          slotKey: "answer style",
        },
      }),
    ).toBe(1);
  });

  it("reconciles a durable queued receipt after the request that stored the message has finished", async () => {
    const userId = await createUser("runtime-queued");
    const conversationId = await createConversation(userId);
    const source = await createMessage({
      conversationId,
      content: "I prefer durable queued maintenance.",
    });
    await db.memoryExtractionReceipt.create({
      data: {
        ownerUserId: userId,
        sourceType: "MESSAGE",
        sourceId: source.id,
        sourceVersion: source.updatedAt.toISOString(),
        status: "QUEUED",
      },
    });

    let calls = 0;
    const model: SemanticPlannerModel = {
      complete: ({ prompt }) => {
        calls += 1;
        if (prompt.startsWith("You extract durable personal memory")) {
          return Promise.resolve(
            JSON.stringify({
              candidates: [
                {
                  type: "USER_PREFERENCE",
                  slotKey: "maintenance mode",
                  content: "Prefers durable queued maintenance",
                  confidence: 0.95,
                  sensitivity: "NORMAL",
                  transient: false,
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          JSON.stringify({ summary: "queued summary" }),
        );
      },
    };

    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    await expect(
      maintenance.reconcilePending(10),
    ).resolves.toBe(1);

    expect(
      await db.memoryItem.findFirst({
        where: {
          ownerUserId: userId,
          slotKey: "maintenance mode",
        },
      }),
    ).not.toBeNull();
    expect(
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          sourceType_sourceId_sourceVersion: {
            sourceType: "MESSAGE",
            sourceId: source.id,
            sourceVersion: source.updatedAt.toISOString(),
          },
        },
      }),
    ).toMatchObject({
      status: "COMPLETED",
      attemptCount: 1,
      candidateCount: 1,
    });
    expect(calls).toBe(1);
  });

  it("never sends secret-like source content to the automatic extraction model", async () => {
    const userId = await createUser("runtime-secret-source");
    const conversationId = await createConversation(userId);
    const source = await createMessage({
      conversationId,
      content:
        "api_key = sk-abcdefghijklmnopqrstuvwxyz123456",
    });

    let called = false;
    const model: SemanticPlannerModel = {
      complete: () => {
        called = true;
        return Promise.resolve(
          JSON.stringify({ candidates: [] }),
        );
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-secret-source",
    });

    expect(called).toBe(false);
    expect(
      await db.memoryItem.count({
        where: { ownerUserId: userId },
      }),
    ).toBe(0);
    expect(
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          sourceType_sourceId_sourceVersion: {
            sourceType: "MESSAGE",
            sourceId: source.id,
            sourceVersion: source.updatedAt.toISOString(),
          },
        },
      }),
    ).toMatchObject({
      status: "COMPLETED",
      candidateCount: 0,
    });
  });

  it("fails extraction closed on invalid model output without breaking the source message", async () => {
    const userId = await createUser("runtime-invalid");
    const conversationId =
      await createConversation(userId);
    const source = await createMessage({
      conversationId,
      content: "INVALID_MEMORY_OUTPUT",
    });
    const model: SemanticPlannerModel = {
      complete: () => Promise.resolve("not-json"),
    };

    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );
    await expect(
      maintenance.observeConversationMessage({
        userId,
        messageId: source.id,
        correlationId: "runtime-invalid-1",
      }),
    ).resolves.toBeUndefined();

    expect(
      await db.memoryItem.count({
        where: { ownerUserId: userId },
      }),
    ).toBe(0);
    expect(
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          sourceType_sourceId_sourceVersion: {
            sourceType: "MESSAGE",
            sourceId: source.id,
            sourceVersion: source.updatedAt.toISOString(),
          },
        },
      }),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "MODEL_OUTPUT_INVALID",
    });
  });

  it("redacts secret-like raw history before sending L2 compaction prompts", async () => {
    const userId = await createUser("runtime-compaction-redaction");
    const conversationId = await createConversation(userId);
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const history = [];
    for (let index = 0; index < 12; index += 1) {
      history.push(
        await createMessage({
          conversationId,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content:
            index === 1
              ? `api_key = ${secret} ` + "s".repeat(900)
              : `safe-${index} ` + "x".repeat(900),
        }),
      );
    }
    const source = history[10];
    if (!source) {
      throw new Error("expected compaction trigger source");
    }

    let compactionPrompt = "";
    const model: SemanticPlannerModel = {
      complete: ({ prompt }) => {
        if (prompt.startsWith("You extract durable personal memory")) {
          return Promise.resolve(
            JSON.stringify({ candidates: [] }),
          );
        }
        compactionPrompt = prompt;
        return Promise.resolve(
          JSON.stringify({
            summary: "Safe compacted state",
          }),
        );
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-compaction-redaction",
    });

    expect(compactionPrompt).toContain(
      "[SENSITIVE_DATA_REDACTED]",
    );
    expect(compactionPrompt).not.toContain(secret);
    expect(
      await db.compactedContextState.count({
        where: {
          ownerUserId: userId,
          conversationId,
          invalidatedAt: null,
        },
      }),
    ).toBe(1);
  });

  it("builds incremental L2 state from previous summary plus older raw segments while retaining raw history", async () => {
    const userId = await createUser("runtime-compaction");
    const conversationId =
      await createConversation(userId);
    const firstBatch = [];
    for (let index = 0; index < 10; index += 1) {
      firstBatch.push(
        await createMessage({
          conversationId,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content:
            `first-${index} ` + "x".repeat(900),
        }),
      );
    }

    let extractionCalls = 0;
    let compactionCalls = 0;
    const model: SemanticPlannerModel = {
      complete: async ({ prompt }) => {
        if (prompt.startsWith("You extract durable personal memory")) {
          extractionCalls += 1;
          return JSON.stringify({ candidates: [] });
        }
        if (
          prompt.startsWith(
            "Create the next loss-minimizing compacted conversation state",
          )
        ) {
          compactionCalls += 1;
          return JSON.stringify({
            summary: `summary-v${compactionCalls}`,
          });
        }
        throw new Error("unexpected prompt");
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    const firstTrigger = firstBatch[8];
    if (!firstTrigger) {
      throw new Error("expected first compaction trigger message");
    }
    await maintenance.observeConversationMessage({
      userId,
      messageId: firstTrigger.id,
      correlationId: "runtime-compact-v1",
    });
    const v1 =
      await db.compactedContextState.findFirstOrThrow({
        where: {
          ownerUserId: userId,
          conversationId,
          invalidatedAt: null,
        },
      });
    expect(v1.version).toBe(1);
    expect(v1.sourceCount).toBeGreaterThan(0);
    expect(compactionCalls).toBe(1);

    const secondBatch = [];
    for (let index = 0; index < 10; index += 1) {
      secondBatch.push(
        await createMessage({
          conversationId,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content:
            `second-${index} ` + "y".repeat(900),
        }),
      );
    }
    const secondTrigger = secondBatch[8];
    if (!secondTrigger) {
      throw new Error("expected second compaction trigger message");
    }
    await maintenance.observeConversationMessage({
      userId,
      messageId: secondTrigger.id,
      correlationId: "runtime-compact-v2",
    });

    const active =
      await db.compactedContextState.findFirstOrThrow({
        where: {
          ownerUserId: userId,
          conversationId,
          invalidatedAt: null,
        },
      });
    expect(active.version).toBe(2);
    expect(active.sourceCount).toBeGreaterThan(
      v1.sourceCount,
    );
    expect(compactionCalls).toBe(2);
    expect(
      (
        await db.compactedContextState.findUniqueOrThrow({
          where: { id: v1.id },
        })
      ).invalidationReason,
    ).toBe("SUPERSEDED");

    const refs = active.sourceRefs as Array<{
      sourceType: string;
      sourceId: string;
    }>;
    expect(refs.some((ref) =>
      ref.sourceType === "COMPACTED_STATE" &&
      ref.sourceId === v1.id,
    )).toBe(true);
    expect(
      await db.message.count({
        where: { conversationId },
      }),
    ).toBe(20);
    expect(extractionCalls).toBe(2);
  });

  it("terminalizes a stale final-attempt PENDING receipt instead of leaving it stuck forever", async () => {
    const userId = await createUser("runtime-max-attempt");
    const conversationId = await createConversation(userId);
    const source = await createMessage({
      conversationId,
      content: "Final-attempt maintenance source",
    });
    const receipt = await db.memoryExtractionReceipt.create({
      data: {
        ownerUserId: userId,
        sourceType: "MESSAGE",
        sourceId: source.id,
        sourceVersion: source.updatedAt.toISOString(),
        status: "PENDING",
        attemptCount: 5,
      },
    });
    await db.memoryExtractionReceipt.update({
      where: { id: receipt.id },
      data: {
        updatedAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    let called = false;
    const model: SemanticPlannerModel = {
      complete: () => {
        called = true;
        return Promise.resolve(JSON.stringify({ candidates: [] }));
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    await maintenance.reconcilePending(10);
    expect(
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    ).toMatchObject({
      status: "FAILED",
      attemptCount: 5,
      errorCode: "MAX_ATTEMPTS_EXHAUSTED",
    });
    expect(called).toBe(false);
  });

  it("retries failed compaction from the durable receipt without duplicating extracted Memory", async () => {
    const userId = await createUser("runtime-compaction-retry");
    const conversationId = await createConversation(userId);
    const history = [];
    for (let index = 0; index < 12; index += 1) {
      history.push(
        await createMessage({
          conversationId,
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content:
            `retry-history-${index} ` + "r".repeat(900),
        }),
      );
    }
    const source = history[10];
    if (!source) {
      throw new Error("expected retry trigger message");
    }
    await db.memoryExtractionReceipt.create({
      data: {
        ownerUserId: userId,
        sourceType: "MESSAGE",
        sourceId: source.id,
        sourceVersion: source.updatedAt.toISOString(),
        status: "QUEUED",
      },
    });

    let extractionCalls = 0;
    let compactionCalls = 0;
    const model: SemanticPlannerModel = {
      complete: ({ prompt }) => {
        if (prompt.startsWith("You extract durable personal memory")) {
          extractionCalls += 1;
          return Promise.resolve(
            JSON.stringify({
              candidates: [
                {
                  type: "USER_PREFERENCE",
                  slotKey: "retry style",
                  content: "Prefers durable retry semantics",
                  confidence: 0.95,
                  sensitivity: "NORMAL",
                  transient: false,
                },
              ],
            }),
          );
        }
        compactionCalls += 1;
        if (compactionCalls === 1) {
          return Promise.reject(
            new Error("simulated compaction outage"),
          );
        }
        return Promise.resolve(
          JSON.stringify({
            summary: "Recovered compacted state",
          }),
        );
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );

    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-compaction-fail",
    });
    const failed =
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: {
          sourceType_sourceId_sourceVersion: {
            sourceType: "MESSAGE",
            sourceId: source.id,
            sourceVersion: source.updatedAt.toISOString(),
          },
        },
      });
    expect(failed.status).toBe("FAILED");
    expect(failed.attemptCount).toBe(1);
    expect(failed.extractedAt).not.toBeNull();
    expect(failed.compactedAt).toBeNull();
    expect(
      await db.memoryItem.count({
        where: {
          ownerUserId: userId,
          slotKey: "retry style",
        },
      }),
    ).toBe(1);

    await db.memoryExtractionReceipt.update({
      where: { id: failed.id },
      data: {
        updatedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    await maintenance.observeConversationMessage({
      userId,
      messageId: source.id,
      correlationId: "runtime-compaction-retry",
    });

    const completed =
      await db.memoryExtractionReceipt.findUniqueOrThrow({
        where: { id: failed.id },
      });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.attemptCount).toBe(2);
    expect(completed.extractedAt).not.toBeNull();
    expect(completed.compactedAt).not.toBeNull();
    expect(
      await db.memoryItem.count({
        where: {
          ownerUserId: userId,
          slotKey: "retry style",
        },
      }),
    ).toBe(1);
    expect(
      await db.compactedContextState.count({
        where: {
          ownerUserId: userId,
          conversationId,
          invalidatedAt: null,
        },
      }),
    ).toBe(1);
    expect(extractionCalls).toBe(1);
    expect(compactionCalls).toBe(2);
  });

  it("never treats Direct Chat rows as automatic memory sources", async () => {
    const userId = await createUser("runtime-direct");
    const peerId = await createUser("runtime-direct-peer");
    const conversation =
      await db.directConversation.create({
        data: {
          pairKey: [userId, peerId].sort().join(":"),
          members: {
            create: [
              { userId },
              { userId: peerId },
            ],
          },
        },
      });
    const device = await db.userCryptoDevice.create({
      data: {
        userId,
        identityEd25519Public: "ed-runtime",
        identityX25519Public: "x-runtime",
        signedPrekeyId: 1,
        signedPrekeyPublic: "spk-runtime",
        signedPrekeySignature: "sig-runtime",
      },
    });
    const direct = await db.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderUserId: userId,
        senderDeviceId: device.id,
        clientMessageId: randomUUID(),
        kind: "HUMAN",
      },
    });

    let called = false;
    const model: SemanticPlannerModel = {
      complete: () => {
        called = true;
        return Promise.resolve(
          JSON.stringify({ candidates: [] }),
        );
      },
    };
    const prisma = prismaService();
    const maintenance = new MemoryMaintenanceService(
      prisma,
      new MemoryFacade(prisma, config),
      config,
      model,
    );
    await maintenance.observeConversationMessage({
      userId,
      messageId: direct.id,
      correlationId: "runtime-direct",
    });
    expect(called).toBe(false);
    expect(
      await db.memoryExtractionReceipt.count({
        where: { ownerUserId: userId },
      }),
    ).toBe(0);
  });
});
