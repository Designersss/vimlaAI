import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { seedVimlaAiModels } from "@vimla/ai";
import { seedVimlaPlans } from "@vimla/billing";
import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { createVimlaApiApp } from "../create-app.js";
import { registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("operator API", () => {
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
    process.env.AI_TEXT_ENABLED = "true";
    process.env.AI_TEXT_PROVIDER = "mock";
    process.env.OPERATOR_ENABLED = "true";

    const prisma = createPrismaClient(testDatabaseUrl);
    await seedVimlaPlans(prisma);
    await seedVimlaAiModels(prisma);
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

  it("rejects unauthenticated and injected owner fields", async () => {
    const anon = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      payload: { clientRequestId: randomUUID(), content: "@Vimla create a task" },
    });
    expect(anon.statusCode).toBe(401);

    const user = await readyUser(app, "op-inject");
    const injected = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        clientRequestId: randomUUID(),
        content: "@Vimla create a task",
        userId: "other-user",
        permissions: ["admin"],
      },
    });
    expect(injected.statusCode).toBe(400);
  });

  it("creates a task through @Vimla and is idempotent on replay", async () => {
    const user = await readyUser(app, "op-create");
    const clientRequestId = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId, content: "@Vimla создай задачу купить билеты завтра" },
    });
    expect(first.statusCode).toBe(201);
    const body = first.json() as { status: string; actions: Array<{ title: string; status: string }>; id: string };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.actions[0]?.title.toLowerCase()).toContain("билет");
    expect(JSON.stringify(body)).not.toMatch(/inputJson|plannerOutput|userId/);
    expect(JSON.stringify(body)).not.toMatch(/VIMLA_OPERATOR_PLANNER/);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().conversations).toEqual([]);

    const thread = await app.inject({
      method: "GET",
      url: "/v1/operator/conversation",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(thread.statusCode).toBe(200);
    expect(JSON.stringify(thread.json())).not.toMatch(/VIMLA_OPERATOR_PLANNER|"commands"|inputJson/);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId, content: "@Vimla создай задачу купить билеты завтра" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(body.id);

    const tasks = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(tasks.json().items).toHaveLength(1);
  });

  it("creates a list with items in a bounded multi-tool flow", async () => {
    const user = await readyUser(app, "op-list");
    const created = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId: randomUUID(), content: "@Vimla создай список вещей в поездку" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("SUCCEEDED");
    const lists = await app.inject({
      method: "GET",
      url: "/v1/workspace/lists",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(lists.json().items.length).toBeGreaterThan(0);
    expect(lists.json().items[0].items.length).toBeGreaterThan(0);
  });

  it("requires confirmation before deleting and does not leak other users' runs", async () => {
    const owner = await readyUser(app, "op-del-owner");
    const stranger = await readyUser(app, "op-del-stranger");
    const task = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { title: "Secret task" },
    });
    const taskId = task.json().id as string;

    const run = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { clientRequestId: randomUUID(), content: `@Vimla удали задачу ${taskId}` },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().status).toBe("AWAITING_CONFIRMATION");
    expect(run.json().confirmationRequired).toBe(true);
    const token = run.json().confirmationToken as string;
    expect(token).toEqual(expect.any(String));

    const stillThere = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks/${taskId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(stillThere.statusCode).toBe(200);

    const stolen = await app.inject({
      method: "GET",
      url: `/v1/operator/runs/${run.json().id}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.statusCode).toBe(404);

    const stolenConfirm = await app.inject({
      method: "POST",
      url: `/v1/operator/runs/${run.json().id}/confirm`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: { confirmationToken: token },
    });
    expect(stolenConfirm.statusCode).toBe(404);

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/operator/runs/${run.json().id}/confirm`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { confirmationToken: token },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("SUCCEEDED");

    const replayConfirm = await app.inject({
      method: "POST",
      url: `/v1/operator/runs/${run.json().id}/confirm`,
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { confirmationToken: token },
    });
    expect(replayConfirm.statusCode).toBe(200);
    expect(replayConfirm.json().status).toBe("SUCCEEDED");

    const gone = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks/${taskId}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("asks for clarification when a reschedule is ambiguous", async () => {
    const user = await readyUser(app, "op-clarify");
    const run = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId: randomUUID(), content: "@Vimla перенеси напоминание на пятницу" },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().status).toBe("AWAITING_CLARIFICATION");
    expect(run.json().clarificationQuestion).toBeTruthy();

    const reminder = await app.inject({
      method: "POST",
      url: "/v1/workspace/reminders",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        title: "Call dentist",
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        timezone: "Europe/Moscow",
      },
    });
    expect(reminder.statusCode).toBe(201);

    const continued = await app.inject({
      method: "POST",
      url: `/v1/operator/runs/${run.json().id}/continue`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        clientRequestId: randomUUID(),
        content: `перенеси напоминание ${reminder.json().id as string} на пятницу`,
      },
    });
    expect(continued.statusCode).toBe(200);
    expect(continued.json().status).toBe("SUCCEEDED");
  });

  it("refuses payment and admin requests without calling those tools", async () => {
    const user = await readyUser(app, "op-refuse");
    const run = await app.inject({
      method: "POST",
      url: "/v1/operator/runs",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { clientRequestId: randomUUID(), content: "@Vimla оплати подписку и смени пароль" },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().status).toBe("SUCCEEDED");
    expect(run.json().actions).toEqual([]);
  });
});

async function readyUser(app: NestFastifyApplication, label: string) {
  const user = await registerVerifiedUser(app, label);
  const purchased = await app.inject({
    method: "POST",
    url: "/dev/mock-purchases/subscription",
    headers: jsonHeaders(),
    cookies: user.cookies,
    payload: { planCode: "PRO" },
  });
  expect(purchased.statusCode).toBe(201);
  const tz = await app.inject({
    method: "PATCH",
    url: "/v1/me/preferences",
    headers: jsonHeaders(),
    cookies: user.cookies,
    payload: { timezone: "Europe/Moscow" },
  });
  expect(tz.statusCode).toBe(200);
  return user;
}

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}
