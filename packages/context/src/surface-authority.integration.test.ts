import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@vimla/database";
import {
  createSurfaceAuthorityRegistry,
} from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("surface authority adapters", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps AI Thread authority owner-scoped and server-authoritative", async () => {
    const ownerId = await createUser(prisma, "authority-ai-owner");
    const strangerId = await createUser(prisma, "authority-ai-stranger");
    const conversation = await prisma.conversation.create({
      data: {
        userId: ownerId,
        kind: "CHAT",
        title: "Authority AI thread",
      },
    });
    const surface =
      await prisma.communicationSurface.findUniqueOrThrow({
        where: { conversationId: conversation.id },
        select: { id: true },
      });
    const registry = createSurfaceAuthorityRegistry(prisma);

    await expect(
      registry.resolve({
        actorUserId: ownerId,
        surfaceId: surface.id,
      }),
    ).resolves.toMatchObject({
      surfaceId: surface.id,
      kind: "AI_THREAD",
      domainId: conversation.id,
      canRead: true,
      canContribute: true,
      audienceUserIds: [ownerId],
      disclosurePolicy: {
        serverPlaintextAvailable: true,
        clientDisclosureRequired: false,
        peerContentRequiresConsent: false,
      },
    });

    await expect(
      registry.resolve({
        actorUserId: strangerId,
        surfaceId: surface.id,
      }),
    ).resolves.toMatchObject({
      canRead: false,
      canContribute: false,
      eligibleReadScopes: [],
      eligibleWriteScopes: [],
      capabilities: [],
    });
  });

  it("re-resolves Direct Chat membership and never grants server plaintext", async () => {
    const actorId = await createUser(prisma, "authority-direct-actor");
    const peerId = await createUser(prisma, "authority-direct-peer");
    const conversation =
      await prisma.directConversation.create({
        data: {
          pairKey: `authority:${randomUUID()}`,
          members: {
            create: [
              { userId: actorId },
              { userId: peerId },
            ],
          },
        },
      });
    const surface =
      await prisma.communicationSurface.findUniqueOrThrow({
        where: {
          directConversationId: conversation.id,
        },
        select: { id: true },
      });
    const registry = createSurfaceAuthorityRegistry(prisma);

    const first = await registry.resolve({
      actorUserId: actorId,
      surfaceId: surface.id,
    });
    expect(first).toMatchObject({
      kind: "DIRECT",
      domainId: conversation.id,
      canRead: true,
      canContribute: true,
      disclosurePolicy: {
        serverPlaintextAvailable: false,
        clientDisclosureRequired: true,
        peerContentRequiresConsent: true,
      },
    });
    expect(first.audienceUserIds).toEqual(
      [actorId, peerId].sort(),
    );

    await prisma.directConversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: peerId,
        },
      },
    });

    const afterPeerRevocation = await registry.resolve({
      actorUserId: actorId,
      surfaceId: surface.id,
    });
    expect(afterPeerRevocation.audienceUserIds).toEqual([
      actorId,
    ]);

    await prisma.directConversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: actorId,
        },
      },
    });

    await expect(
      registry.resolve({
        actorUserId: actorId,
        surfaceId: surface.id,
      }),
    ).resolves.toMatchObject({
      canRead: false,
      canContribute: false,
      eligibleReadScopes: [],
      eligibleWriteScopes: [],
      capabilities: [],
    });
  });
});

async function createUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<string> {
  const suffix = randomUUID();
  const id = `${prefix}-${suffix}`;
  await prisma.user.create({
    data: {
      id,
      name: "Surface Authority Test",
      email: `${suffix}@surface-authority.test`,
      emailVerified: true,
    },
  });
  return id;
}
