import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { seedVimlaPlans } from "@vimla/billing";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { registerUnverifiedUser, registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("projects API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.PROJECTS_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    await prisma.$disconnect();

    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("fails closed when Projects are disabled", async () => {
    const previous = process.env.PROJECTS_ENABLED;
    process.env.PROJECTS_ENABLED = "false";
    const config = loadApiConfig(process.env);
    expect(config.projectsEnabled).toBe(false);
    process.env.PROJECTS_ENABLED = previous ?? "true";

    const isolated = await createVimlaApiApp(config, { quiet: true });
    await isolated.init();
    await isolated.getHttpAdapter().getInstance().ready();
    try {
      const user = await registerVerifiedUser(isolated, "proj-disabled");
      const created = await isolated.inject({
        method: "POST",
        url: "/v1/projects",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { name: "Hidden" },
      });
      expect(created.statusCode).toBe(503);
      expect(errorCode(created)).toBe("projects_disabled");
    } finally {
      await isolated.close();
    }
  });

  it("rejects extra owner fields, unverified mutations and IDOR reads", async () => {
    const unverified = await registerUnverifiedUser(app, "proj-unverified");
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: jsonHeaders(),
      cookies: unverified.cookies,
      payload: { name: "Nope" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(errorCode(blocked)).toBe("email_not_verified");

    const owner = await registerVerifiedUser(app, "proj-idor-owner");
    const stranger = await registerVerifiedUser(app, "proj-idor-stranger");
    const injected = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {
        name: "Alpha",
        ownerUserId: stranger.id,
        userId: stranger.id,
        lastOpenedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(injected.statusCode).toBe(400);

    const created = await createProject(app, owner.cookies, "Alpha");
    const stolen = await app.inject({
      method: "GET",
      url: `/v1/projects/${created.id}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.statusCode).toBe(404);
    expect(errorCode(stolen)).toBe("not_found");

    const stolenPatch = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${created.id}`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: { name: "Hijacked" },
    });
    expect(stolenPatch.statusCode).toBe(404);
  });

  it("does not change lastOpenedAt on list or get, only on open", async () => {
    const owner = await registerVerifiedUser(app, "proj-open");
    await buyPro(app, owner.cookies);
    const created = await createProject(app, owner.cookies, "Opened later");
    const prisma = app.get(PrismaService).client;

    const listed = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(listed.statusCode).toBe(200);
    const peeked = await app.inject({
      method: "GET",
      url: `/v1/projects/${created.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(peeked.statusCode).toBe(200);

    const before = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: created.id, userId: owner.id } },
    });
    expect(before.lastOpenedAt).toBeNull();

    const opened = await app.inject({
      method: "POST",
      url: `/v1/projects/${created.id}/open`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(opened.statusCode).toBe(200);

    const afterOpen = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: created.id, userId: owner.id } },
    });
    expect(afterOpen.lastOpenedAt).not.toBeNull();
    const openedAt = afterOpen.lastOpenedAt?.toISOString();

    await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { origin },
      cookies: owner.cookies,
    });
    await app.inject({
      method: "GET",
      url: `/v1/projects/${created.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    const afterReads = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: created.id, userId: owner.id } },
    });
    expect(afterReads.lastOpenedAt?.toISOString()).toBe(openedAt);
  });

  it("locks extra owned projects after paid → Free using lastOpenedAt and restores after paid", async () => {
    const owner = await registerVerifiedUser(app, "proj-downgrade");
    const member = await registerVerifiedUser(app, "proj-downgrade-member");
    await buyPro(app, owner.cookies);
    await buyPro(app, member.cookies);

    const first = await createProject(app, owner.cookies, "First");
    await sleep(5);
    const second = await createProject(app, owner.cookies, "Second");
    await sleep(5);
    const third = await createProject(app, owner.cookies, "Third");

    await openProject(app, owner.cookies, first.id);
    await sleep(5);
    await openProject(app, owner.cookies, second.id);
    await sleep(5);
    await openProject(app, owner.cookies, third.id);

    const invite = await inviteMember(app, owner.cookies, second.id, member.email, "MEMBER");
    await acceptInvite(app, member.cookies, invite.inviteUrl);

    await expireActiveSubscription(app, owner.id);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as Array<{ id: string; projectState: string; viewerState: string }>;
    expect(items).toHaveLength(3);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(third.id)?.projectState).toBe("ACTIVE");
    expect(byId.get(first.id)?.projectState).toBe("PLAN_LOCKED");
    expect(byId.get(second.id)?.projectState).toBe("PLAN_LOCKED");

    const lockedPatch = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${second.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { name: "Should fail" },
    });
    expect(lockedPatch.statusCode).toBe(403);
    expect(errorCode(lockedPatch)).toBe("project_plan_locked");

    const paidMemberPatch = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${second.id}`,
      headers: jsonHeaders(),
      cookies: member.cookies,
      payload: { name: "Paid rescue" },
    });
    expect(paidMemberPatch.statusCode).toBe(403);
    expect(errorCode(paidMemberPatch)).toBe("project_plan_locked");

    const createFourth = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { name: "Fourth" },
    });
    expect(createFourth.statusCode).toBe(403);
    expect(errorCode(createFourth)).toBe("project_owned_limit");

    await openProject(app, owner.cookies, first.id);
    const afterSwitch = await app.inject({
      method: "GET",
      url: `/v1/projects/${first.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(afterSwitch.json().projectState).toBe("ACTIVE");
    const previous = await app.inject({
      method: "GET",
      url: `/v1/projects/${third.id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(previous.json().projectState).toBe("PLAN_LOCKED");

    const stillMember = await app.inject({
      method: "GET",
      url: `/v1/projects/${second.id}/members`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(stillMember.statusCode).toBe(200);
    expect(stillMember.json().items.some((row: { userId: string }) => row.userId === member.id)).toBe(true);

    await buyPro(app, owner.cookies);
    const restored = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { origin },
      cookies: owner.cookies,
    });
    for (const item of restored.json().items as Array<{ projectState: string }>) {
      expect(item.projectState).toBe("ACTIVE");
    }
  });

  it("keeps two last-opened joined projects for a Free member without removing memberships", async () => {
    const owner = await registerVerifiedUser(app, "proj-ext-owner");
    const guest = await registerVerifiedUser(app, "proj-ext-guest");
    await buyPro(app, owner.cookies);

    const one = await createProject(app, owner.cookies, "Join One");
    const two = await createProject(app, owner.cookies, "Join Two");
    const three = await createProject(app, owner.cookies, "Join Three");
    for (const project of [one, two, three]) {
      const invite = await inviteMember(app, owner.cookies, project.id, guest.email, "MEMBER");
      await acceptInvite(app, guest.cookies, invite.inviteUrl);
    }

    await openProject(app, guest.cookies, one.id);
    await sleep(5);
    await openProject(app, guest.cookies, two.id);
    await sleep(5);
    await openProject(app, guest.cookies, three.id);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { origin },
      cookies: guest.cookies,
    });
    const items = listed.json().items as Array<{ id: string; viewerState: string; projectState: string }>;
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(three.id)?.viewerState).toBe("ACTIVE");
    expect(byId.get(two.id)?.viewerState).toBe("ACTIVE");
    expect(byId.get(one.id)?.viewerState).toBe("READ_ONLY_BY_MEMBER_PLAN");
    expect(byId.get(one.id)?.projectState).toBe("ACTIVE");

    const lockedWrite = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${one.id}`,
      headers: jsonHeaders(),
      cookies: guest.cookies,
      payload: { name: "Guest edit" },
    });
    expect(lockedWrite.statusCode).toBe(403);
    expect(errorCode(lockedWrite)).toBe("project_entitlement_denied");

    const ownerWrite = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${one.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { name: "Owner still writes" },
    });
    expect(ownerWrite.statusCode).toBe(200);

    await buyPro(app, guest.cookies);
    const restored = await app.inject({
      method: "GET",
      url: `/v1/projects/${one.id}`,
      headers: { origin },
      cookies: guest.cookies,
    });
    expect(restored.json().viewerState).toBe("ACTIVE");
  });

  it("enforces owner/admin/member roles for invite, leave and ownership", async () => {
    const owner = await registerVerifiedUser(app, "proj-roles-owner");
    const admin = await registerVerifiedUser(app, "proj-roles-admin");
    const member = await registerVerifiedUser(app, "proj-roles-member");
    await buyPro(app, owner.cookies);
    const project = await createProject(app, owner.cookies, "Crew");

    const adminInvite = await inviteMember(app, owner.cookies, project.id, admin.email, "ADMIN");
    await acceptInvite(app, admin.cookies, adminInvite.inviteUrl);
    const memberInvite = await inviteMember(app, admin.cookies, project.id, member.email, "VIEWER");
    await acceptInvite(app, member.cookies, memberInvite.inviteUrl);

    const ownerLeave = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/leave`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: {},
    });
    expect(ownerLeave.statusCode).toBe(403);
    expect(errorCode(ownerLeave)).toBe("project_role_forbidden");

    const transfer = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}/members/${owner.id}`,
      headers: jsonHeaders(),
      cookies: admin.cookies,
      payload: { role: "MEMBER" },
    });
    expect(transfer.statusCode).toBe(403);
    expect(errorCode(transfer)).toBe("project_role_forbidden");

    const memberInviteAttempt = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/invites`,
      headers: jsonHeaders(),
      cookies: member.cookies,
      payload: { email: "other@example.com", role: "MEMBER" },
    });
    expect(memberInviteAttempt.statusCode).toBe(403);

    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}/members/${member.id}`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { role: "MEMBER" },
    });

    const left = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/leave`,
      headers: jsonHeaders(),
      cookies: member.cookies,
      payload: {},
    });
    expect(left.statusCode).toBe(204);
    const afterLeave = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.id}`,
      headers: { origin },
      cookies: member.cookies,
    });
    expect(afterLeave.statusCode).toBe(404);
  });
});

async function createProject(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  name: string,
): Promise<{ id: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: jsonHeaders(),
    cookies,
    payload: { name },
  });
  expect(created.statusCode).toBe(201);
  return created.json() as { id: string };
}

async function openProject(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  projectId: string,
): Promise<void> {
  const opened = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/open`,
    headers: jsonHeaders(),
    cookies,
    payload: {},
  });
  expect(opened.statusCode).toBe(200);
}

async function inviteMember(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  projectId: string,
  email: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<{ inviteUrl: string }> {
  const created = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/invites`,
    headers: jsonHeaders(),
    cookies,
    payload: { email, role },
  });
  expect(created.statusCode).toBe(201);
  const body = created.json() as { inviteUrl: string | null };
  if (typeof body.inviteUrl !== "string" || body.inviteUrl.length === 0) {
    throw new Error("expected inviteUrl");
  }
  return { inviteUrl: body.inviteUrl };
}

async function acceptInvite(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  inviteUrlValue: string,
): Promise<void> {
  const token = new URL(inviteUrlValue).searchParams.get("token");
  if (!token) {
    throw new Error("expected invite token");
  }
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/projects/invites/accept",
    headers: jsonHeaders(),
    cookies,
    payload: { token },
  });
  expect(accepted.statusCode).toBe(200);
}

async function buyPro(app: NestFastifyApplication, cookies: Record<string, string>): Promise<void> {
  const purchased = await app.inject({
    method: "POST",
    url: "/dev/mock-purchases/subscription",
    headers: jsonHeaders(),
    cookies,
    payload: { planCode: "PRO" },
  });
  expect(purchased.statusCode).toBe(201);
}

async function expireActiveSubscription(app: NestFastifyApplication, userId: string): Promise<void> {
  await app.get(PrismaService).client.subscription.updateMany({
    where: { userId, status: "ACTIVE" },
    data: { status: "EXPIRED", periodEnd: new Date("2020-01-01T00:00:00.000Z") },
  });
}

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}

function errorCode(response: { json: () => unknown }): string {
  const body = response.json() as { error?: { code?: string } };
  return body.error?.code ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
