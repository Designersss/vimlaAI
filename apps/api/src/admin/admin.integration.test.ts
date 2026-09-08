import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AdminControlService, ADMIN_COOKIE_NAME, hashAdminToken } from "@vimla/admin";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient, type PrismaClient } from "@vimla/database";
import { FinanceQueryService, seedVimlaPlans } from "@vimla/billing";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const webOrigin = "http://localhost:3000";
const adminOrigin = "http://localhost:3002";

describe("admin control plane", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let control: AdminControlService;
  let configSecret: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "test";
    process.env.LOG_LEVEL = "error";
    process.env.API_HOST = "127.0.0.1";
    process.env.API_PORT = "3001";
    process.env.WEB_ORIGIN = webOrigin;
    process.env.ADMIN_ORIGIN = adminOrigin;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ?? "local-dev-only-change-me-use-32-chars-min";
    process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    process.env.ADMIN_REQUIRE_TOTP = "true";
    process.env.ADMIN_REQUIRE_PASSKEY = "false";
    process.env.ADMIN_STEP_UP_SECONDS = "900";

    prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    const config = loadApiConfig(process.env);
    configSecret = config.betterAuthSecret;
    control = new AdminControlService(prisma, {
      secret: config.betterAuthSecret,
      ttlSeconds: config.adminSessionTtlSeconds,
      idleSeconds: config.adminSessionIdleSeconds,
      stepUpSeconds: config.adminStepUpSeconds,
      requireTotp: config.adminRequireTotp,
      requirePasskey: config.adminRequirePasskey,
      cookieSecure: false,
    });
    app = await createVimlaApiApp(config, { quiet: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  it("denies a normal user the Admin API", async () => {
    const user = await registerVerifiedUser(app, "plain");
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: user.cookies,
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects elevate without TOTP even for an AdminPrincipal", async () => {
    const user = await registerVerifiedUser(app, "nomfa");
    await control.bootstrapOwner(user.id);
    const response = await app.inject({
      method: "POST",
      url: "/admin/v1/auth/elevate",
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: user.cookies,
      payload: {},
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("allows an Admin session with permission and denies missing permission", async () => {
    const owner = await registerVerifiedUser(app, "owner");
    await control.bootstrapOwner(owner.id);
    const session = await control.createSession({ userId: owner.id });
    const allowed = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(allowed.statusCode).toBe(200);
    const overview = allowed.json() as { overview: { outstandingTopupUsageMicroRub: string } };
    expect(overview.overview.outstandingTopupUsageMicroRub).toBeDefined();

    const limited = await registerVerifiedUser(app, "limited");
    const role = await prisma.adminRole.create({
      data: { code: `READER-${limited.id.slice(0, 8)}`, permissions: ["users.read"] },
    });
    const principal = await prisma.adminPrincipal.create({
      data: {
        userId: limited.id,
        status: "ACTIVE",
        roles: { create: { roleId: role.id } },
      },
    });
    void principal;
    const limitedSession = await control.createSession({ userId: limited.id });
    const denied = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: limitedSession.token },
    });
    expect(denied.statusCode).toBe(403);
    const users = await app.inject({
      method: "GET",
      url: "/admin/v1/users",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: limitedSession.token },
    });
    expect(users.statusCode).toBe(200);
  });

  it("denies a disabled AdminPrincipal", async () => {
    const user = await registerVerifiedUser(app, "disabled");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    await control.disablePrincipal(user.id);
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(response.statusCode).toBe(401);
  });

  it("does not treat an ordinary session as an AdminSession", async () => {
    const user = await registerVerifiedUser(app, "ordinary");
    await control.bootstrapOwner(user.id);
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/tariffs/plans",
      headers: { origin: adminOrigin },
      cookies: user.cookies,
    });
    expect(response.statusCode).toBe(401);
  });

  it("denies expired and revoked Admin sessions", async () => {
    const user = await registerVerifiedUser(app, "expiry");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    await prisma.adminSession.updateMany({
      where: { tokenHash: hashAdminToken(session.token, configSecret) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(expired.statusCode).toBe(401);

    const fresh = await control.createSession({ userId: user.id });
    await control.revokeSessions(user.id);
    const revoked = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: fresh.token },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("rejects sensitive publish with a stale step-up", async () => {
    const user = await registerVerifiedUser(app, "stale");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    await prisma.adminSession.updateMany({
      where: { tokenHash: hashAdminToken(session.token, configSecret) },
      data: { lastStrongAuthAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "T199" } });
    const draft = await app.inject({
      method: "POST",
      url: "/admin/v1/tariffs/plans/drafts",
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        planId: plan.id,
        priceMicroRub: "199000000",
        monthlyUsageGrantMicroRub: "0",
        subscriptionPeriodDays: 30,
        entitlements: [{ key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: true } }],
      },
    });
    expect(draft.statusCode).toBe(403);
  });

  it("rejects Admin mutations from the user web origin", async () => {
    const user = await registerVerifiedUser(app, "origin");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    const response = await app.inject({
      method: "POST",
      url: "/admin/v1/tariffs/plans/drafts",
      headers: { origin: webOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        planId: "x",
        priceMicroRub: "1",
        monthlyUsageGrantMicroRub: "0",
        subscriptionPeriodDays: 30,
        entitlements: [],
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("creates, simulates and publishes a draft, then rejects commercial edits", async () => {
    const user = await registerVerifiedUser(app, "tariff");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "T199" } });
    const created = await app.inject({
      method: "POST",
      url: "/admin/v1/tariffs/plans/drafts",
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        planId: plan.id,
        priceMicroRub: "199000000",
        monthlyUsageGrantMicroRub: "1000000",
        subscriptionPeriodDays: 30,
        entitlements: [
          { key: "projects.ownedActiveMax", value: { kind: "COUNT", unlimited: false, value: "3" } },
          { key: "projects.externalActiveMax", value: { kind: "COUNT", unlimited: false, value: "4" } },
          {
            key: "projects.membersPerOwnedProjectMax",
            value: { kind: "COUNT", unlimited: false, value: "4" },
          },
          { key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: true } },
        ],
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    const draft = created.json() as { id: string };
    const deprecated = await app.inject({
      method: "POST",
      url: "/admin/v1/tariffs/plans/drafts",
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        planId: plan.id,
        priceMicroRub: "199000000",
        monthlyUsageGrantMicroRub: "1000000",
        subscriptionPeriodDays: 30,
        entitlements: [{ key: "projects.max", value: { kind: "COUNT", unlimited: false, value: "1" } }],
      },
    });
    expect(deprecated.statusCode).toBe(400);

    const simulated = await app.inject({
      method: "POST",
      url: `/admin/v1/tariffs/plans/${draft.id}/simulate`,
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(simulated.statusCode).toBe(200);

    const published = await app.inject({
      method: "POST",
      url: `/admin/v1/tariffs/plans/${draft.id}/publish`,
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        acknowledgeNegativeOrLowMargin: true,
        reason: "intentional promotion",
        typedPlanCode: "T199",
      },
    });
    expect(published.statusCode).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "PLAN_PUBLISHED", resourceId: draft.id },
    });
    expect(audit).not.toBeNull();
    if (!audit) {
      throw new Error("PLAN_PUBLISHED audit row was missing");
    }
    await expect(
      prisma.adminAuditLog.update({
        where: { id: audit.id },
        data: { reason: "tamper" },
      }),
    ).rejects.toThrow(/append-only/);

    const edit = await prisma.planVersion.update({
      where: { id: draft.id },
      data: { priceMicroRub: 1n },
    }).catch((error: unknown) => error);
    expect(edit).toBeInstanceOf(Error);
  });

  it("does not expose a top-up expiry field", async () => {
    const user = await registerVerifiedUser(app, "topup");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    const listed = await app.inject({
      method: "GET",
      url: "/admin/v1/tariffs/top-up",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as { expirySupported: boolean; current: Record<string, unknown> | null };
    expect(body.expirySupported).toBe(false);
  });

  it("matches FinanceQueryService totals on the Admin overview", async () => {
    const user = await registerVerifiedUser(app, "finmatch");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    const domain = await new FinanceQueryService(prisma).overview();
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/finance/overview",
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      overview: {
        grossRevenueMicroRub: string;
        netSalesMicroRub: string;
        refundsMicroRub: string;
        realizedAiCogsMicroRub: string;
        outstandingTopupUsageMicroRub: string;
        expiredMonthlyUsageMicroRub: string;
      };
      usage: { topupNeverExpires: boolean };
    };
    expect(body.overview.grossRevenueMicroRub).toBe(domain.grossRevenueMicroRub.toString());
    expect(body.overview.netSalesMicroRub).toBe(domain.netSalesMicroRub.toString());
    expect(body.overview.refundsMicroRub).toBe(domain.refundsMicroRub.toString());
    expect(body.overview.realizedAiCogsMicroRub).toBe(domain.realizedAiCogsMicroRub.toString());
    expect(body.overview.outstandingTopupUsageMicroRub).toBe(
      domain.outstandingTopupUsageMicroRub.toString(),
    );
    expect(body.overview.expiredMonthlyUsageMicroRub).toBe(domain.expiredMonthlyUsageMicroRub.toString());
    expect(body.usage.topupNeverExpires).toBe(true);
  });

  it("refuses a negative-margin publish without high-risk confirmation", async () => {
    const user = await registerVerifiedUser(app, "negmargin");
    await control.bootstrapOwner(user.id);
    const session = await control.createSession({ userId: user.id });
    const plan = await prisma.plan.findFirstOrThrow({ where: { code: "T199" } });
    const created = await app.inject({
      method: "POST",
      url: "/admin/v1/tariffs/plans/drafts",
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        planId: plan.id,
        priceMicroRub: "199000000",
        monthlyUsageGrantMicroRub: "199000000",
        subscriptionPeriodDays: 30,
        entitlements: [
          { key: "projects.ownedActiveMax", value: { kind: "COUNT", unlimited: false, value: "3" } },
          { key: "billing.topupAllowed", value: { kind: "BOOLEAN", value: true } },
        ],
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    const draft = created.json() as { id: string };
    const refused = await app.inject({
      method: "POST",
      url: `/admin/v1/tariffs/plans/${draft.id}/publish`,
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {},
    });
    expect(refused.statusCode).toBe(400);
    const published = await app.inject({
      method: "POST",
      url: `/admin/v1/tariffs/plans/${draft.id}/publish`,
      headers: { origin: adminOrigin, "content-type": "application/json" },
      cookies: { [ADMIN_COOKIE_NAME]: session.token },
      payload: {
        acknowledgeNegativeOrLowMargin: true,
        reason: "intentional promotion",
        typedPlanCode: "T199",
      },
    });
    expect(published.statusCode).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "PLAN_PUBLISHED", resourceId: draft.id },
    });
    expect(audit?.reason).toBe("intentional promotion");
  });
});
