import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiRuntimeConfig } from "../config/api-config.js";
import type { RedisService } from "../persistence/redis.service.js";
import { redisFixedWindowHit } from "../persistence/rate-limit.js";
import { TrustRateLimitGuard } from "./trust-rate-limit.guard.js";
import type { TrustFacade } from "./trust.facade.js";

vi.mock("../persistence/rate-limit.js", () => ({
  redisFixedWindowHit: vi.fn(),
}));

const redis = { client: {} } as unknown as RedisService;
const hit = vi.mocked(redisFixedWindowHit);
const exactReplay = vi.fn();
const facade = {
  service: { findExactReportReplay: exactReplay },
} as unknown as TrustFacade;
const replayPayload = {
  requestId: "c2a93b7d-1fc4-4ce5-9b4b-a5688197d0c3",
  targetHandle: "targetperson",
  reason: "SPAM",
};

afterEach(() => {
  hit.mockReset();
  exactReplay.mockReset();
});

function guard(): TrustRateLimitGuard {
  return new TrustRateLimitGuard(
    redis,
    {
      appEnv: "test",
      trustReadLimitPerMinute: 120,
      trustMutationLimitPerMinute: 60,
      trustReportLimitPerMinute: 6,
      trustReportIpLimitPerMinute: 12,
      webOrigin: "http://localhost:3000",
    } as ApiRuntimeConfig,
    facade,
  );
}

function requestContext(
  rawUrl: string,
  matchedRoute: string,
  method = "POST",
  body?: unknown,
): ExecutionContext {
  const request = {
    method,
    url: rawUrl,
    routeOptions: { url: matchedRoute },
    vimlaUser: { id: "reporter-1" },
    ip: "198.51.100.201",
    headers: { origin: "http://localhost:3000" },
    body,
  } as unknown as FastifyRequest;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("TrustRateLimitGuard", () => {
  it("uses the matched report route even if the raw URL is encoded", async () => {
    hit.mockResolvedValue(true);

    expect(
      await guard().canActivate(
        requestContext("/v1/trust/%72eports", "/v1/trust/reports"),
      ),
    ).toBe(true);

    expect(hit).toHaveBeenCalledTimes(2);
    expect(hit).toHaveBeenNthCalledWith(
      1,
      redis.client,
      "ratelimit:trust:report:user:reporter-1",
      6,
    );
    expect(hit).toHaveBeenNthCalledWith(
      2,
      redis.client,
      "ratelimit:trust:report:ip:198.51.100.201",
      12,
    );
  });

  it("does not charge the shared IP quota when the reporter is already limited", async () => {
    hit.mockResolvedValueOnce(false);

    await expect(
      guard().canActivate(
        requestContext("/v1/trust/reports", "/v1/trust/reports"),
      ),
    ).rejects.toMatchObject({ status: 429 });

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith(
      redis.client,
      "ratelimit:trust:report:user:reporter-1",
      6,
    );
  });

  it("still rejects a report if its shared IP quota is exhausted", async () => {
    hit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      guard().canActivate(
        requestContext("/v1/trust/reports", "/v1/trust/reports"),
      ),
    ).rejects.toMatchObject({ status: 429 });

    expect(hit).toHaveBeenCalledTimes(2);
    expect(hit).toHaveBeenNthCalledWith(
      2,
      redis.client,
      "ratelimit:trust:report:ip:198.51.100.201",
      12,
    );
  });

  it("allows exact persisted retries after quota through separate bounded counters", async () => {
    hit.mockResolvedValue(true);
    hit.mockResolvedValueOnce(false);
    exactReplay.mockResolvedValue({
      id: "7d3fb2d8-3120-4e61-83a2-98ed592335c0",
      status: "SUBMITTED",
      createdAt: "2026-10-08T12:00:00.000Z",
    });

    await expect(
      guard().canActivate(
        requestContext("/v1/trust/reports", "/v1/trust/reports", "POST", replayPayload),
      ),
    ).resolves.toBe(true);
    expect(exactReplay).toHaveBeenCalledWith("reporter-1", replayPayload);
    expect(hit).toHaveBeenNthCalledWith(
      2, redis.client, "ratelimit:trust:report:replay:user:reporter-1", 6,
    );
    expect(hit).toHaveBeenNthCalledWith(
      3, redis.client, "ratelimit:trust:report:replay:ip:198.51.100.201", 12,
    );
  });

  it("caps replay probes and rejects unknown reports", async () => {
    hit.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(
      guard().canActivate(
        requestContext("/v1/trust/reports", "/v1/trust/reports", "POST", replayPayload),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(exactReplay).not.toHaveBeenCalled();
    expect(hit).toHaveBeenCalledTimes(2);
  });

  it("does not look up a replay for a foreign origin", async () => {
    hit.mockResolvedValueOnce(false);
    const context = requestContext(
      "/v1/trust/reports", "/v1/trust/reports", "POST", replayPayload,
    );
    context.switchToHttp().getRequest<FastifyRequest>().headers.origin =
      "https://evil.example";
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(exactReplay).not.toHaveBeenCalled();
  });

  it("keeps ordinary trust mutations on their independent quota", async () => {
    hit.mockResolvedValue(true);

    expect(
      await guard().canActivate(
        requestContext("/v1/trust/blocks", "/v1/trust/blocks"),
      ),
    ).toBe(true);

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith(
      redis.client,
      "ratelimit:trust:mutate:user:reporter-1",
      60,
    );
  });
});
