import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import { WORKSPACE_LIMITS } from "@vimla/contracts";
import { PrismaService } from "../persistence/prisma.service.js";
import { createVimlaApiApp } from "../create-app.js";
import { registerUnverifiedUser, registerVerifiedUser } from "../test/identity-helpers.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("personal workspace API", () => {
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

  it("returns timezone on /v1/me and never wipes it on locale-only updates", async () => {
    const user = await registerVerifiedUser(app, "tz-pref");
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ timezone: null });

    const invalid = await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { timezone: "UTC+3" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(errorCode(invalid)).toBe("invalid_timezone");

    const setTz = await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { timezone: "Europe/Moscow" },
    });
    expect(setTz.statusCode).toBe(200);
    expect(setTz.json()).toMatchObject({ timezone: "Europe/Moscow", locale: "ru" });

    const localeOnly = await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { locale: "en" },
    });
    expect(localeOnly.statusCode).toBe(200);
    expect(localeOnly.json()).toMatchObject({ timezone: "Europe/Moscow", locale: "en" });
  });

  it("rejects extra owner fields and creates a task atomically", async () => {
    const user = await registerVerifiedUser(app, "task-create");
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        title: "Injected",
        userId: "other-user",
        personalOwnerUserId: "other-user",
        scopeType: "PERSONAL",
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(rejected.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Write tests", priority: "HIGH" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      kind: "TASK",
      title: "Write tests",
      status: "TODO",
      completedAt: null,
    });
    expect(created.json()).not.toHaveProperty("personalOwnerUserId");
  });

  it("returns 404 for another user's objects and after soft delete", async () => {
    const owner = await registerVerifiedUser(app, "idor-owner");
    const stranger = await registerVerifiedUser(app, "idor-stranger");
    const created = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { title: "Private task" },
    });
    const id = created.json().id as string;

    const stolen = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks/${id}`,
      headers: { origin },
      cookies: stranger.cookies,
    });
    expect(stolen.statusCode).toBe(404);
    expect(errorCode(stolen)).toBe("not_found");

    const patchStolen = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/tasks/${id}`,
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: { title: "Hijacked" },
    });
    expect(patchStolen.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/workspace/tasks/${id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks/${id}`,
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(afterDelete.statusCode).toBe(404);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks",
      headers: { origin },
      cookies: owner.cookies,
    });
    expect(listed.json().items.some((item: { id: string }) => item.id === id)).toBe(false);
  });

  it("sets and clears completedAt with DONE", async () => {
    const user = await registerVerifiedUser(app, "task-done");
    const created = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Finish docs", status: "DONE" },
    });
    expect(created.statusCode).toBe(400);
    expect(errorCode(created)).toBe("workspace_status_invalid");

    const open = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Finish docs" },
    });
    const id = open.json().id as string;
    const done = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/tasks/${id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { status: "DONE" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("DONE");
    expect(done.json().completedAt).toBeTruthy();

    const reopened = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/tasks/${id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { status: "TODO" },
    });
    expect(reopened.json()).toMatchObject({ status: "TODO", completedAt: null });
  });

  it("paginates tasks without duplicate ids", async () => {
    const user = await registerVerifiedUser(app, "task-page");
    const ids: string[] = [];
    for (const title of ["One", "Two", "Three"]) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/workspace/tasks",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { title },
      });
      ids.push(created.json().id as string);
    }
    const first = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?limit=2",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: { origin },
      cookies: user.cookies,
    });
    const pageIds = [
      ...first.json().items.map((item: { id: string }) => item.id),
      ...second.json().items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(pageIds).size).toBe(pageIds.length);
    expect(ids.every((id) => pageIds.includes(id))).toBe(true);
  });

  it("lists tasks with active-before-finished dueAt order and stable pagination", async () => {
    const user = await registerVerifiedUser(app, "task-order");
    async function createTask(title: string, payload: Record<string, unknown> = {}): Promise<string> {
      const created = await app.inject({
        method: "POST",
        url: "/v1/workspace/tasks",
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { title, ...payload },
      });
      expect(created.statusCode).toBe(201);
      return created.json().id as string;
    }
    async function patchStatus(id: string, status: string): Promise<void> {
      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/workspace/tasks/${id}`,
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { status },
      });
      expect(patched.statusCode).toBe(200);
    }

    await createTask("undated");
    await createTask("later", { dueAt: "2026-09-20T00:00:00.000Z" });
    await createTask("earlier", { dueAt: "2026-09-10T00:00:00.000Z" });
    const progressId = await createTask("progress", { dueAt: "2026-09-11T00:00:00.000Z" });
    await patchStatus(progressId, "IN_PROGRESS");
    const doneId = await createTask("done");
    await patchStatus(doneId, "DONE");
    const canceledId = await createTask("canceled");
    await patchStatus(canceledId, "CANCELED");

    const listed = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?limit=50",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(listed.json().items.map((item: { title: string }) => item.title)).toEqual([
      "earlier",
      "progress",
      "later",
      "undated",
      "canceled",
      "done",
    ]);

    const todos = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?status=TODO&limit=50",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(todos.json().items.map((item: { title: string }) => item.title)).toEqual(["earlier", "later", "undated"]);

    const finished = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?status=DONE&limit=50",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(finished.json().items.map((item: { title: string }) => item.title)).toEqual(["done"]);

    const first = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?limit=4",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(first.json().items.map((item: { title: string }) => item.title)).toEqual([
      "earlier",
      "progress",
      "later",
      "undated",
    ]);
    expect(first.json().nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks?limit=4&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect(second.json().items.map((item: { title: string }) => item.title)).toEqual(["canceled", "done"]);
    const pageIds = [
      ...first.json().items.map((item: { id: string }) => item.id),
      ...second.json().items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(pageIds).size).toBe(6);

    const pageA = await app.inject({
      method: "GET",
      url: "/v1/workspace/tasks?limit=2",
      headers: { origin },
      cookies: user.cookies,
    });
    const pageB = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks?limit=2&cursor=${encodeURIComponent(pageA.json().nextCursor)}`,
      headers: { origin },
      cookies: user.cookies,
    });
    const pageC = await app.inject({
      method: "GET",
      url: `/v1/workspace/tasks?limit=2&cursor=${encodeURIComponent(pageB.json().nextCursor)}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect([
      ...pageA.json().items,
      ...pageB.json().items,
      ...pageC.json().items,
    ].map((item: { title: string }) => item.title)).toEqual([
      "earlier",
      "progress",
      "later",
      "undated",
      "canceled",
      "done",
    ]);
  });

  it("requires timezone for reminders and rejects delivered status", async () => {
    const user = await registerVerifiedUser(app, "reminder-tz");
    const missing = await app.inject({
      method: "POST",
      url: "/v1/workspace/reminders",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Call", scheduledAt: "2026-09-09T15:00:00.000Z" },
    });
    expect(missing.statusCode).toBe(400);
    expect(errorCode(missing)).toBe("timezone_required");

    const created = await app.inject({
      method: "POST",
      url: "/v1/workspace/reminders",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {
        title: "Call",
        scheduledAt: "2026-09-09T15:00:00.000Z",
        timezone: "Europe/Moscow",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "PENDING", timezone: "Europe/Moscow" });

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(me.json().timezone).toBe("Europe/Moscow");

    const delivered = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/reminders/${created.json().id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { status: "DELIVERED" },
    });
    expect(delivered.statusCode).toBe(400);
  });

  it("rejects linking another user's task to a reminder", async () => {
    const owner = await registerVerifiedUser(app, "link-owner");
    const stranger = await registerVerifiedUser(app, "link-stranger");
    const task = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: owner.cookies,
      payload: { title: "Owner task" },
    });
    await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: { timezone: "Europe/Moscow" },
    });
    const linked = await app.inject({
      method: "POST",
      url: "/v1/workspace/reminders",
      headers: jsonHeaders(),
      cookies: stranger.cookies,
      payload: {
        title: "Steal",
        scheduledAt: "2026-09-09T15:00:00.000Z",
        linkedTaskId: task.json().id,
      },
    });
    expect(linked.statusCode).toBe(404);
  });

  it("keeps list reorder atomic and rejects cross-list items", async () => {
    const user = await registerVerifiedUser(app, "list-reorder");
    const list = await app.inject({
      method: "POST",
      url: "/v1/workspace/lists",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { type: "CHECKLIST", title: "Groceries" },
    });
    const listId = list.json().id as string;
    const first = await app.inject({
      method: "POST",
      url: `/v1/workspace/lists/${listId}/items`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { text: "Milk" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/workspace/lists/${listId}/items`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { text: "Eggs" },
    });
    const itemIds = second.json().items.map((item: { id: string }) => item.id) as string[];
    expect(itemIds).toHaveLength(2);

    const invalidReorder = await app.inject({
      method: "POST",
      url: `/v1/workspace/lists/${listId}/reorder`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { itemIds: [itemIds[0]] },
    });
    expect(invalidReorder.statusCode).toBe(400);
    expect(errorCode(invalidReorder)).toBe("workspace_reorder_invalid");
    const unchanged = await app.inject({
      method: "GET",
      url: `/v1/workspace/lists/${listId}`,
      headers: { origin },
      cookies: user.cookies,
    });
    expect(unchanged.json().items.map((item: { id: string }) => item.id)).toEqual(itemIds);

    const reordered = await app.inject({
      method: "POST",
      url: `/v1/workspace/lists/${listId}/reorder`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { itemIds: [itemIds[1], itemIds[0]] },
    });
    expect(reordered.json().items.map((item: { id: string }) => item.id)).toEqual([itemIds[1], itemIds[0]]);

    const other = await app.inject({
      method: "POST",
      url: "/v1/workspace/lists",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { type: "PLAIN", title: "Other" },
    });
    const crossed = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/lists/${other.json().id}/items/${itemIds[0]}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { text: "Hijack" },
    });
    expect(crossed.statusCode).toBe(404);
    expect(first.statusCode).toBe(201);
  });

  it("serializes concurrent list capacity checks and position allocation", async () => {
    const user = await registerVerifiedUser(app, "list-race");
    const created = await app.inject({
      method: "POST",
      url: "/v1/workspace/lists",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { type: "PLAIN", title: "Bounded" },
    });
    const listId = created.json().id as string;
    await app.get(PrismaService).client.workspaceListItem.createMany({
      data: Array.from({ length: WORKSPACE_LIMITS.listItemsMax - 1 }, (_, position) => ({
        listObjectId: listId,
        text: `Existing ${position}`,
        position,
      })),
    });
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) => app.inject({
        method: "POST",
        url: `/v1/workspace/lists/${listId}/items`,
        headers: jsonHeaders(),
        cookies: user.cookies,
        payload: { text: `Concurrent ${index}` },
      })),
    );
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    const items = await app.get(PrismaService).client.workspaceListItem.findMany({
      where: { listObjectId: listId },
      orderBy: { position: "asc" },
    });
    expect(items).toHaveLength(WORKSPACE_LIMITS.listItemsMax);
    expect(new Set(items.map((item) => item.position)).size).toBe(items.length);
    expect(items.map((item) => item.position)).toEqual(Array.from({ length: WORKSPACE_LIMITS.listItemsMax }, (_, index) => index));
  });

  it("pins, archives and searches notes", async () => {
    const user = await registerVerifiedUser(app, "notes");
    const note = await app.inject({
      method: "POST",
      url: "/v1/workspace/notes",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Alpha", contentMarkdown: "searchable body" },
    });
    const id = note.json().id as string;
    const pinned = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/notes/${id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { pinned: true },
    });
    expect(pinned.json().pinnedAt).toBeTruthy();

    const archived = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/notes/${id}`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { archived: true },
    });
    expect(archived.json().archivedAt).toBeTruthy();

    const active = await app.inject({
      method: "GET",
      url: "/v1/workspace/notes",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(active.json().items.some((item: { id: string }) => item.id === id)).toBe(false);

    const found = await app.inject({
      method: "GET",
      url: "/v1/workspace/notes?archived=true&q=searchable",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(found.json().items.some((item: { id: string }) => item.id === id)).toBe(true);
  });

  it("aggregates today using the stored timezone", async () => {
    const user = await registerVerifiedUser(app, "today");
    await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { timezone: "Europe/Moscow" },
    });
    const now = new Date();
    await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Due today", dueAt: now.toISOString() },
    });
    await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Overdue", dueAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString() },
    });
    await app.inject({
      method: "POST",
      url: "/v1/workspace/reminders",
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: { title: "Today reminder", scheduledAt: now.toISOString() },
    });
    const today = await app.inject({
      method: "GET",
      url: "/v1/workspace/today",
      headers: { origin },
      cookies: user.cookies,
    });
    expect(today.statusCode).toBe(200);
    expect(today.json().timezone).toBe("Europe/Moscow");
    expect(today.json().todayTasks.some((item: { title: string }) => item.title === "Due today")).toBe(true);
    expect(today.json().overdueTasks.some((item: { title: string }) => item.title === "Overdue")).toBe(true);
    expect(today.json().todayReminders.some((item: { title: string }) => item.title === "Today reminder")).toBe(true);
  });

  it("blocks unverified mutations and untrusted origins", async () => {
    const unverified = await registerUnverifiedUser(app, "unverified-work");
    const denied = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: jsonHeaders(),
      cookies: unverified.cookies,
      payload: { title: "Nope" },
    });
    expect(denied.statusCode).toBe(403);

    const verified = await registerVerifiedUser(app, "origin-work");
    const untrusted = await app.inject({
      method: "POST",
      url: "/v1/workspace/tasks",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      cookies: verified.cookies,
      payload: { title: "Nope" },
    });
    expect(untrusted.statusCode).toBe(403);
  });
});

function jsonHeaders(): Record<string, string> {
  return { origin, "content-type": "application/json" };
}

function errorCode(response: { json: () => unknown }): string {
  const body = response.json() as { error?: { code?: string } };
  return body.error?.code ?? "";
}
