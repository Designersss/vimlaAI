import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiConfig } from "@vimla/config/server";
import {
  REALTIME_PROTOCOL_VERSION,
  realtimePongFrameSchema,
  realtimeServerFrameSchema,
  type RealtimeEventEnvelope,
  type RealtimeServerFrame,
} from "@vimla/contracts";
import { WebSocket, type RawData } from "ws";
import { createVimlaApiApp } from "../create-app.js";
import { ClientInstallationsService } from "../installations/client-installations.service.js";
import { RedisService } from "../persistence/redis.service.js";
import {
  registerVerifiedUser,
} from "../test/identity-helpers.js";
import { RealtimeService } from "./realtime.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
}

const origin = "http://localhost:3000";

describe("global realtime WebSocket gateway", () => {
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    configureTestEnv();
    const config = loadApiConfig(process.env);
    app = await createVimlaApiApp(config, {
      quiet: true,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("authenticates the upgrade and binds it to an active owned installation", async () => {
    const owner = await registerVerifiedUser(
      app,
      "rt-owner",
    );
    const stranger = await registerVerifiedUser(
      app,
      "rt-stranger",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      owner.cookies,
      installationId,
    );

    await expect(
      rejectedUpgrade({
        baseUrl,
        installationId,
        origin,
      }),
    ).resolves.toBe(401);

    await expect(
      rejectedUpgrade({
        baseUrl,
        installationId,
        origin,
        cookies: owner.cookies,
        protocolVersion: 2,
      }),
    ).resolves.toBe(400);

    await expect(
      rejectedUpgrade({
        baseUrl,
        installationId,
        origin: "https://evil.example",
        cookies: owner.cookies,
      }),
    ).resolves.toBe(403);

    await expect(
      rejectedUpgrade({
        baseUrl,
        installationId,
        origin,
        cookies: stranger.cookies,
      }),
    ).resolves.toBe(404);

    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: owner.cookies,
    });
    expect(connection.hello.frameType).toBe("HELLO");
    expect(connection.hello.installationId).toBe(
      installationId,
    );
    connection.socket.close();
  });

  it("rate limits authenticated WebSocket handshakes before repeated authorization work", async () => {
    const limited = await createVimlaApiApp(
      {
        ...loadApiConfig(process.env),
        realtimeHandshakeLimitPerMinute: 2,
      },
      { quiet: true },
    );
    await limited.listen(0, "127.0.0.1");
    try {
      const limitedUrl = await limited.getUrl();
      const user = await registerVerifiedUser(
        limited,
        "rt-handshake-limit",
      );
      const installationId = randomUUID();
      await registerInstallation(
        limited,
        user.cookies,
        installationId,
      );

      for (let index = 0; index < 2; index += 1) {
        const connection = await openRealtime({
          baseUrl: limitedUrl,
          installationId,
          origin,
          cookies: user.cookies,
        });
        const closed = waitForClose(connection.socket);
        connection.socket.close();
        await closed;
      }

      await expect(
        rejectedUpgrade({
          baseUrl: limitedUrl,
          installationId,
          origin,
          cookies: user.cookies,
        }),
      ).resolves.toBe(429);
    } finally {
      await limited.close();
    }
  });

  it("delivers one user event to multiple installations without cross-user leakage", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-fanout-user",
    );
    const other = await registerVerifiedUser(
      app,
      "rt-fanout-other",
    );
    const firstId = randomUUID();
    const secondId = randomUUID();
    const otherId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      firstId,
    );
    await registerInstallation(
      app,
      user.cookies,
      secondId,
    );
    await registerInstallation(
      app,
      other.cookies,
      otherId,
    );

    const [first, second, foreign] =
      await Promise.all([
        openRealtime({
          baseUrl,
          installationId: firstId,
          origin,
          cookies: user.cookies,
        }),
        openRealtime({
          baseUrl,
          installationId: secondId,
          origin,
          cookies: user.cookies,
        }),
        openRealtime({
          baseUrl,
          installationId: otherId,
          origin,
          cookies: other.cookies,
        }),
      ]);

    const conversationId = randomUUID();
    const messageId = randomUUID();
    const firstEvent = waitForEvent(first.socket);
    const secondEvent = waitForEvent(second.socket);
    let foreignEvent = false;
    const foreignListener = (data: RawData): void => {
      const frame = parseFrame(data);
      if (frame.frameType === "EVENT") {
        foreignEvent = true;
      }
    };
    foreign.socket.on("message", foreignListener);

    await app
      .get(RealtimeService)
      .publishDirectMessageCreated([user.id], {
        conversationId,
        messageId,
        occurredAt: new Date().toISOString(),
      });

    const [left, right] = await Promise.all([
      firstEvent,
      secondEvent,
    ]);
    for (const event of [left, right]) {
      expect(event.eventId).toBe(messageId);
      expect(event.eventType).toBe(
        "DIRECT_MESSAGE_CREATED",
      );
      expect(event.payload).toEqual({
        conversationId,
        messageId,
      });
    }

    await sleep(100);
    expect(foreignEvent).toBe(false);

    foreign.socket.off("message", foreignListener);
    first.socket.close();
    second.socket.close();
    foreign.socket.close();
  });

  it("rejects arbitrary client subscription frames", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-invalid-frame",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );
    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: user.cookies,
    });

    const closed = waitForClose(connection.socket);
    connection.socket.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "SUBSCRIBE",
        topic: "realtime:user:someone-else",
      }),
    );
    await expect(closed).resolves.toBe(4004);
  });

  it("enforces the configured incoming frame byte limit", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-frame-limit",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );
    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: user.cookies,
    });

    const closed = waitForClose(connection.socket);
    connection.socket.send("x".repeat(8_193));
    await expect(closed).resolves.toBe(1009);
  });

  it("bounds concurrent tabs for one installation", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-connection-cap",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );

    const connections: OpenRealtime[] = [];
    try {
      for (
        let index = 0;
        index < 8;
        index += 1
      ) {
        connections.push(
          await openRealtime({
            baseUrl,
            installationId,
            origin,
            cookies: user.cookies,
          }),
        );
      }

      await expect(
        rejectedUpgrade({
          baseUrl,
          installationId,
          origin,
          cookies: user.cookies,
        }),
      ).resolves.toBe(429);
    } finally {
      for (const connection of connections) {
        connection.socket.close();
      }
    }
  });

  it("closes an active connection after installation revoke and refuses reconnect", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-revoked",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );
    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: user.cookies,
    });
    const closed = waitForClose(connection.socket);

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/client-installations/${installationId}/revoke`,
      headers: jsonHeaders(),
      cookies: user.cookies,
      payload: {},
    });
    expect(revoked.statusCode).toBe(200);
    await expect(closed).resolves.toBe(4003);

    await expect(
      rejectedUpgrade({
        baseUrl,
        installationId,
        origin,
        cookies: user.cookies,
      }),
    ).resolves.toBe(404);
  });

  it("closes connections that do not answer application heartbeats", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-heartbeat-timeout",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );
    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: user.cookies,
      answerHeartbeats: false,
    });
    await expect(
      waitForClose(connection.socket),
    ).resolves.toBe(4001);
  });

  it("treats transient heartbeat authorization infrastructure failures as retryable", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-heartbeat-infra",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );
    const connection = await openRealtime({
      baseUrl,
      installationId,
      origin,
      cookies: user.cookies,
    });

    const installations = app.get(
      ClientInstallationsService,
    );
    const activeSpy = vi
      .spyOn(installations, "isActiveOwned")
      .mockRejectedValueOnce(
        new Error("database temporarily unavailable"),
      );
    try {
      await expect(
        waitForClose(connection.socket),
      ).resolves.toBe(1013);
    } finally {
      activeSpy.mockRestore();
      if (
        connection.socket.readyState ===
        WebSocket.OPEN
      ) {
        connection.socket.close();
      }
    }
  });

  it("fans out across API instances through Redis", async () => {
    const user = await registerVerifiedUser(
      app,
      "rt-cross-instance",
    );
    const installationId = randomUUID();
    await registerInstallation(
      app,
      user.cookies,
      installationId,
    );

    const second = await createVimlaApiApp(
      loadApiConfig(process.env),
      { quiet: true },
    );
    await second.listen(0, "127.0.0.1");
    try {
      const secondUrl = await second.getUrl();
      const connection = await openRealtime({
        baseUrl: secondUrl,
        installationId,
        origin,
        cookies: user.cookies,
      });
      const eventPromise =
        waitForEvent(connection.socket);
      const conversationId = randomUUID();
      const messageId = randomUUID();

      await app
        .get(RealtimeService)
        .publishDirectMessageCreated([user.id], {
          conversationId,
          messageId,
          occurredAt: new Date().toISOString(),
        });

      await expect(eventPromise).resolves.toMatchObject({
        eventId: messageId,
        payload: {
          conversationId,
          messageId,
        },
      });
      connection.socket.close();
    } finally {
      await second.close();
    }
  });

  it("treats Redis publication failure as delivery acceleration failure, not mutation failure", async () => {
    const redis = app.get(RedisService).client;
    const publish = vi
      .spyOn(redis, "publish")
      .mockRejectedValueOnce(
        new Error("redis unavailable"),
      );
    try {
      await expect(
        app
          .get(RealtimeService)
          .publishDirectMessageCreated(
            [randomUUID()],
            {
              conversationId: randomUUID(),
              messageId: randomUUID(),
              occurredAt: new Date().toISOString(),
            },
          ),
      ).resolves.toBeUndefined();
    } finally {
      publish.mockRestore();
    }
  });
});

interface OpenRealtime {
  socket: WebSocket;
  hello: Extract<
    RealtimeServerFrame,
    { frameType: "HELLO" }
  >;
}

async function registerInstallation(
  app: NestFastifyApplication,
  cookies: Record<string, string>,
  id: string,
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/client-installations/register",
    headers: jsonHeaders(),
    cookies,
    payload: {
      id,
      kind: "WEB",
      appVersion: "integration-test",
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      capabilities: ["realtime.v1"],
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `installation registration failed: ${response.statusCode} ${response.body}`,
    );
  }
}

async function openRealtime(input: {
  baseUrl: string;
  installationId: string;
  origin: string;
  cookies: Record<string, string>;
  answerHeartbeats?: boolean;
}): Promise<OpenRealtime> {
  const socket = new WebSocket(
    realtimeUrl(
      input.baseUrl,
      input.installationId,
    ),
    {
      headers: {
        origin: input.origin,
        cookie: cookieHeader(input.cookies),
      },
    },
  );

  return new Promise<OpenRealtime>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(
          new Error("Timed out waiting for realtime HELLO"),
        );
      }, 5_000);

      const fail = (error: Error): void => {
        clearTimeout(timer);
        reject(error);
      };
      socket.once("error", fail);
      socket.once(
        "unexpected-response",
        (_request, response) => {
          clearTimeout(timer);
          socket.terminate();
          reject(
            new Error(
              `Unexpected upgrade rejection: ${String(response.statusCode)}`,
            ),
          );
        },
      );
      socket.on("message", (data) => {
        const frame = parseFrame(data);
        if (
          frame.frameType === "HEARTBEAT" &&
          input.answerHeartbeats !== false
        ) {
          socket.send(
            JSON.stringify(
              realtimePongFrameSchema.parse({
                protocolVersion:
                  REALTIME_PROTOCOL_VERSION,
                frameType: "PONG",
                heartbeatId: frame.heartbeatId,
              }),
            ),
          );
          return;
        }
        if (frame.frameType !== "HELLO") {
          return;
        }
        clearTimeout(timer);
        socket.off("error", fail);
        resolve({
          socket,
          hello: frame,
        });
      });
    },
  );
}

async function rejectedUpgrade(input: {
  baseUrl: string;
  installationId: string;
  origin: string;
  cookies?: Record<string, string>;
  protocolVersion?: number;
}): Promise<number> {
  const headers: Record<string, string> = {
    origin: input.origin,
  };
  if (input.cookies) {
    headers.cookie = cookieHeader(input.cookies);
  }
  const socket = new WebSocket(
    realtimeUrl(
      input.baseUrl,
      input.installationId,
      input.protocolVersion,
    ),
    { headers },
  );

  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(
        new Error(
          "Timed out waiting for upgrade rejection",
        ),
      );
    }, 5_000);
    socket.once(
      "unexpected-response",
      (_request, response) => {
        clearTimeout(timer);
        const status = response.statusCode ?? 0;
        socket.terminate();
        resolve(status);
      },
    );
    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      reject(
        new Error(
          "Expected WebSocket upgrade to be rejected",
        ),
      );
    });
    socket.once("error", () => {
      // ws may emit an error after unexpected-response.
      // The HTTP status above remains the assertion source.
    });
  });
}

function waitForEvent(
  socket: WebSocket,
): Promise<RealtimeEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(
        new Error("Timed out waiting for realtime event"),
      );
    }, 5_000);

    const onMessage = (data: RawData): void => {
      const frame = parseFrame(data);
      if (frame.frameType !== "EVENT") {
        return;
      }
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(frame);
    };
    socket.on("message", onMessage);
  });
}

function waitForClose(
  socket: WebSocket,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error("Timed out waiting for socket close"),
      );
    }, 5_000);
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function parseFrame(
  data: RawData,
): RealtimeServerFrame {
  return realtimeServerFrameSchema.parse(
    JSON.parse(data.toString("utf8")) as unknown,
  );
}

function realtimeUrl(
  baseUrl: string,
  installationId: string,
  protocolVersion: number = REALTIME_PROTOCOL_VERSION,
): string {
  const url = new URL(baseUrl);
  url.protocol =
    url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/realtime";
  url.searchParams.set(
    "protocolVersion",
    String(protocolVersion),
  );
  url.searchParams.set(
    "installationId",
    installationId,
  );
  return url.toString();
}

function cookieHeader(
  cookies: Record<string, string>,
): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function jsonHeaders(): Record<string, string> {
  return {
    origin,
    "content-type": "application/json",
  };
}

function configureTestEnv(): void {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "test";
  process.env.LOG_LEVEL = "error";
  process.env.API_HOST = "127.0.0.1";
  process.env.API_PORT = "3001";
  process.env.WEB_ORIGIN = origin;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.REDIS_URL =
    process.env.REDIS_URL ?? "redis://localhost:6379";
  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET ??
    "local-dev-only-change-me-use-32-chars-min";
  process.env.BETTER_AUTH_URL =
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3001";
  process.env.REALTIME_HEARTBEAT_INTERVAL_MS = "50";
  process.env.REALTIME_HEARTBEAT_TIMEOUT_MS = "150";
  process.env.REALTIME_CLIENT_FRAMES_PER_MINUTE = "2000";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
