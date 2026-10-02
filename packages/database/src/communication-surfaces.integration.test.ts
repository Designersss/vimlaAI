import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start PostgreSQL and run `pnpm test:integration`.",
  );
}

describe("communication surface persistence", () => {
  it("creates one immutable surface for each supported communication domain", async () => {
    const client = createPrismaClient(testDatabaseUrl);
    const suffix = randomUUID();
    const firstUserId = `surface-user-a-${suffix}`;
    const secondUserId = `surface-user-b-${suffix}`;
    let conversationId: string | null = null;
    let directConversationId: string | null = null;

    try {
      await client.user.createMany({
        data: [
          {
            id: firstUserId,
            name: "Surface User A",
            email: `surface-a-${suffix}@example.test`,
            emailVerified: true,
          },
          {
            id: secondUserId,
            name: "Surface User B",
            email: `surface-b-${suffix}@example.test`,
            emailVerified: true,
          },
        ],
      });

      const conversation = await client.conversation.create({
        data: {
          userId: firstUserId,
          kind: "CHAT",
          title: "Surface AI thread",
        },
      });
      conversationId = conversation.id;

      const aiSurface =
        await client.communicationSurface.findUniqueOrThrow({
          where: {
            conversationId: conversation.id,
          },
        });
      expect(aiSurface).toMatchObject({
        kind: "AI_THREAD",
        status: "ACTIVE",
        conversationId: conversation.id,
        directConversationId: null,
      });
      expect(aiSurface.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      const direct =
        await client.directConversation.create({
          data: {
            pairKey: `surface-pair-${suffix}`,
            members: {
              create: [
                { userId: firstUserId },
                { userId: secondUserId },
              ],
            },
          },
        });
      directConversationId = direct.id;

      const directSurface =
        await client.communicationSurface.findUniqueOrThrow({
          where: {
            directConversationId: direct.id,
          },
        });
      expect(directSurface).toMatchObject({
        kind: "DIRECT",
        status: "ACTIVE",
        conversationId: null,
        directConversationId: direct.id,
      });

      await expect(
        client.communicationSurface.create({
          data: {
            kind: "AI_THREAD",
            conversationId: conversation.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await expect(
        client.communicationSurface.update({
          where: { id: aiSurface.id },
          data: {
            conversation: { disconnect: true },
            directConversation: {
              connect: { id: direct.id },
            },
            kind: "DIRECT",
          },
        }),
      ).rejects.toThrow();

      const afterRejectedRebind =
        await client.communicationSurface.findUniqueOrThrow({
          where: { id: aiSurface.id },
        });
      expect(afterRejectedRebind).toMatchObject({
        id: aiSurface.id,
        kind: "AI_THREAD",
        conversationId: conversation.id,
        directConversationId: null,
      });

      await expect(
        client.communicationSurface.delete({
          where: { id: aiSurface.id },
        }),
      ).rejects.toThrow();

      expect(
        await client.communicationSurface.findUnique({
          where: { id: aiSurface.id },
        }),
      ).toMatchObject({
        id: aiSurface.id,
        conversationId: conversation.id,
      });
    } finally {
      if (directConversationId) {
        await client.directConversationMember.deleteMany({
          where: { conversationId: directConversationId },
        });
        await client.directConversation.deleteMany({
          where: { id: directConversationId },
        });
      }
      if (conversationId) {
        await client.conversation.deleteMany({
          where: { id: conversationId },
        });
      }
      await client.user.deleteMany({
        where: {
          id: {
            in: [firstUserId, secondUserId],
          },
        },
      });
      await client.$disconnect();
    }
  });

  it("rejects a surface kind that does not match its domain binding", async () => {
    const client = createPrismaClient(testDatabaseUrl);

    try {
      await expect(
        client.communicationSurface.create({
          data: {
            kind: "DIRECT",
          },
        }),
      ).rejects.toThrow();

      await expect(
        client.communicationSurface.create({
          data: {
            kind: "AI_THREAD",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });

  it("keeps OPERATOR conversations outside AI_THREAD surfaces and freezes conversation kind", async () => {
    const client = createPrismaClient(testDatabaseUrl);
    const suffix = randomUUID();
    const userId = `surface-operator-${suffix}`;
    let chatId: string | null = null;
    let operatorId: string | null = null;

    try {
      await client.user.create({
        data: {
          id: userId,
          name: "Surface Operator User",
          email: `surface-operator-${suffix}@example.test`,
          emailVerified: true,
        },
      });

      const operator = await client.conversation.create({
        data: {
          userId,
          kind: "OPERATOR",
          title: "Vimla",
        },
      });
      operatorId = operator.id;

      expect(
        await client.communicationSurface.findUnique({
          where: { conversationId: operator.id },
        }),
      ).toBeNull();

      await expect(
        client.communicationSurface.create({
          data: {
            kind: "AI_THREAD",
            conversationId: operator.id,
          },
        }),
      ).rejects.toThrow();

      const chat = await client.conversation.create({
        data: {
          userId,
          kind: "CHAT",
          title: "AI thread",
        },
      });
      chatId = chat.id;

      const chatSurface =
        await client.communicationSurface.findUniqueOrThrow({
          where: { conversationId: chat.id },
        });
      expect(chatSurface.kind).toBe("AI_THREAD");

      await expect(
        client.conversation.update({
          where: { id: chat.id },
          data: { kind: "OPERATOR" },
        }),
      ).rejects.toThrow();

      await expect(
        client.conversation.update({
          where: { id: operator.id },
          data: { kind: "CHAT" },
        }),
      ).rejects.toThrow();

      expect(
        await client.communicationSurface.findUniqueOrThrow({
          where: { id: chatSurface.id },
        }),
      ).toMatchObject({
        kind: "AI_THREAD",
        conversationId: chat.id,
      });

      expect(
        await client.communicationSurface.findUnique({
          where: { conversationId: operator.id },
        }),
      ).toBeNull();
    } finally {
      if (chatId) {
        await client.conversation.deleteMany({
          where: { id: chatId },
        });
      }
      if (operatorId) {
        await client.conversation.deleteMany({
          where: { id: operatorId },
        });
      }
      await client.user.deleteMany({
        where: { id: userId },
      });
      await client.$disconnect();
    }
  });
  it("advances the shared activity key when supported domains persist messages", async () => {
    const client = createPrismaClient(testDatabaseUrl);
    const suffix = randomUUID();
    const firstUserId = `surface-activity-a-${suffix}`;
    const secondUserId = `surface-activity-b-${suffix}`;
    let conversationId: string | null = null;
    let directConversationId: string | null = null;
    let deviceId: string | null = null;

    try {
      await client.user.createMany({
        data: [
          {
            id: firstUserId,
            name: "Activity User A",
            email: `surface-activity-a-${suffix}@example.test`,
            emailVerified: true,
          },
          {
            id: secondUserId,
            name: "Activity User B",
            email: `surface-activity-b-${suffix}@example.test`,
            emailVerified: true,
          },
        ],
      });

      const conversation = await client.conversation.create({
        data: {
          userId: firstUserId,
          kind: "CHAT",
          title: "Activity AI thread",
        },
      });
      conversationId = conversation.id;
      const aiMessageAt = new Date(Date.now() + 5_000);
      await client.message.create({
        data: {
          conversationId: conversation.id,
          role: "USER",
          content: "activity",
          status: "COMPLETE",
          createdAt: aiMessageAt,
        },
      });
      const aiSurface =
        await client.communicationSurface.findUniqueOrThrow({
          where: { conversationId: conversation.id },
        });
      expect(aiSurface.lastActivityAt.toISOString()).toBe(
        aiMessageAt.toISOString(),
      );

      const direct = await client.directConversation.create({
        data: {
          pairKey: `surface-activity-pair-${suffix}`,
          members: {
            create: [
              { userId: firstUserId },
              { userId: secondUserId },
            ],
          },
        },
      });
      directConversationId = direct.id;
      const device = await client.userCryptoDevice.create({
        data: {
          userId: firstUserId,
          identityEd25519Public: "ed25519-public",
          identityX25519Public: "x25519-public",
          signedPrekeyId: 1,
          signedPrekeyPublic: "signed-prekey-public",
          signedPrekeySignature: "signed-prekey-signature",
        },
      });
      deviceId = device.id;
      const directMessageAt = new Date(Date.now() + 10_000);
      await client.directMessage.create({
        data: {
          conversationId: direct.id,
          senderUserId: firstUserId,
          senderDeviceId: device.id,
          clientMessageId: randomUUID(),
          kind: "HUMAN",
          createdAt: directMessageAt,
        },
      });
      const directSurface =
        await client.communicationSurface.findUniqueOrThrow({
          where: { directConversationId: direct.id },
        });
      expect(directSurface.lastActivityAt.toISOString()).toBe(
        directMessageAt.toISOString(),
      );
    } finally {
      if (directConversationId) {
        await client.directMessageEnvelope.deleteMany({
          where: { message: { conversationId: directConversationId } },
        });
        await client.directMessage.deleteMany({
          where: { conversationId: directConversationId },
        });
        await client.directConversationMember.deleteMany({
          where: { conversationId: directConversationId },
        });
        await client.directConversation.deleteMany({
          where: { id: directConversationId },
        });
      }
      if (deviceId) {
        await client.userCryptoDevice.deleteMany({
          where: { id: deviceId },
        });
      }
      if (conversationId) {
        await client.message.deleteMany({
          where: { conversationId },
        });
        await client.conversation.deleteMany({
          where: { id: conversationId },
        });
      }
      await client.user.deleteMany({
        where: {
          id: {
            in: [firstUserId, secondUserId],
          },
        },
      });
      await client.$disconnect();
    }
  });

});
