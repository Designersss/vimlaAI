import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiRuntimeConfig } from "../config/api-config.js";
import type { RedisService } from "../persistence/redis.service.js";
import { redisFixedWindowHit } from "../persistence/rate-limit.js";
import { TrustRateLimitGuard } from "./trust-rate-limit.guard.js";

vi.mock("../persistence/rate-limit.js", () => ({
  redisFixedWindowHit: vi.fn(),
}));

const redis = { client: {} } as unknown as RedisService;
const hit = vi.mocked(redisFixedWindowHit);

afterEach(() => {
  hit.mockReset();
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
    } as ApiRuntimeConfig,
  );
}

function requestContext(
  rawUrl: string,
  matchedRoute: string,
  method = "POST",
): ExecutionContext {
  const request = {
    method,
    url: rawUrl,
    routeOptions: { url: matchedRoute },
    vimlaUser: { id: "reporter-1" },
    ip: "198.51.100.201",
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
