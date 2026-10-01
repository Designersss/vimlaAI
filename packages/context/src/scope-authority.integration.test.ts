import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@vimla/database";
import {
  createContextScopeAuthorityRegistry,
} from "./scope-authority.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

describe("context source-scope authority adapters", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(testDatabaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("re-resolves project read authority from current membership", async () => {
    const ownerId = await createUser(
      prisma,
      "scope-project-owner",
    );
    const viewerId = await createUser(
      prisma,
      "scope-project-viewer",
    );
    const project = await prisma.project.create({
      data: {
        ownerUserId: ownerId,
        name: "Scope Authority Project",
        members: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: viewerId, role: "VIEWER" },
          ],
        },
      },
    });
    const registry =
      createContextScopeAuthorityRegistry(prisma);
    const scope = {
      kind: "PROJECT" as const,
      projectId: project.id,
    };

    await expect(
      registry.canRead(ownerId, scope),
    ).resolves.toBe(true);
    await expect(
      registry.canRead(viewerId, scope),
    ).resolves.toBe(true);

    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: viewerId,
        },
      },
    });

    await expect(
      registry.canRead(viewerId, scope),
    ).resolves.toBe(false);
    await expect(
      registry.canRead(ownerId, scope),
    ).resolves.toBe(true);
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
      name: "Scope Authority Test",
      email: `${suffix}@scope-authority.test`,
      emailVerified: true,
    },
  });
  return id;
}
