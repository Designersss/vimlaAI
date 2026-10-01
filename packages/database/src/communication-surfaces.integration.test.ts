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
    const suffix = randomUUID();
    const userId = `surface-kind-${suffix}`;
    let conversationId: string | null = null;

    try {
      await client.user.create({
        data: {
          id: userId,
          name: "Surface Kind User",
          email: `surface-kind-${suffix}@example.test`,
          emailVerified: true,
        },
      });
      const conversation = await client.conversation.create({
        data: {
          userId,
          kind: "CHAT",
        },
      });
      conversationId = conversation.id;

      await client.communicationSurface.delete({
        where: { conversationId: conversation.id },
      });

      await expect(
        client.communicationSurface.create({
          data: {
            kind: "DIRECT",
            conversationId: conversation.id,
          },
        }),
      ).rejects.toThrow();

      expect(
        await client.communicationSurface.findUnique({
          where: {
            conversationId: conversation.id,
          },
        }),
      ).toBeNull();
    } finally {
      if (conversationId) {
        await client.conversation.deleteMany({
          where: { id: conversationId },
        });
      }
      await client.user.deleteMany({
        where: { id: userId },
      });
      await client.$disconnect();
    }
  });
});
