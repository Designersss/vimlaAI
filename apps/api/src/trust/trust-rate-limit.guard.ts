import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createAbuseReportSchema } from "@vimla/contracts";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { RedisService } from "../persistence/redis.service.js";
import { redisFixedWindowHit } from "../persistence/rate-limit.js";
import { TrustFacade } from "./trust.facade.js";

const memoryHits = new Map<
  string,
  { count: number; resetAt: number }
>();

@Injectable()
export class TrustRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RedisService)
    private readonly redis: RedisService,
    @Inject(API_CONFIG)
    private readonly config: ApiRuntimeConfig,
    @Inject(TrustFacade)
    private readonly trust: TrustFacade,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<FastifyRequest>();
    const userId = request.vimlaUser?.id;
    if (!userId || request.method === "OPTIONS") {
      return true;
    }

    // Classify the matched Fastify route, not the raw URL. Alternate
    // encodings of an accepted path must never bypass report-specific limits.
    const isReport =
      request.method === "POST" &&
      request.routeOptions.url === "/v1/trust/reports";
    const read =
      request.method === "GET" ||
      request.method === "HEAD";
    const operation = isReport
      ? "report"
      : read
        ? "read"
        : "mutate";
    const max = isReport
      ? this.config.trustReportLimitPerMinute
      : read
        ? this.config.trustReadLimitPerMinute
        : this.config.trustMutationLimitPerMinute;

    const allowed = await this.hit(
      `ratelimit:trust:${operation}:user:${userId}`,
      max,
    );
    // A user over quota must not spend the shared IP creation budget.
    if (
      allowed &&
      (!isReport ||
        (await this.hit(
          `ratelimit:trust:report:ip:${request.ip}`,
          this.config.trustReportIpLimitPerMinute,
        )))
    ) {
      return true;
    }
    if (isReport && (await this.allowCommittedReplay(request, userId))) {
      return true;
    }
    throw new HttpException(
      {
        code: "rate_limited",
        message: isReport
          ? "Too many abuse reports"
          : "Too many safety requests",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async allowCommittedReplay(
    request: FastifyRequest,
    userId: string,
  ): Promise<boolean> {
    // No database lookup for a foreign origin or malformed payload.
    // OriginGuard also enforces the trusted origin at the controller.
    if (request.headers.origin !== this.config.webOrigin) {
      return false;
    }
    const parsed = createAbuseReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return false;
    }
    // Independent bounded probe budgets, distinct from creation quotas.
    if (
      !(await this.hit(
        `ratelimit:trust:report:replay:user:${userId}`,
        this.config.trustReportLimitPerMinute,
      )) ||
      !(await this.hit(
        `ratelimit:trust:report:replay:ip:${request.ip}`,
        this.config.trustReportIpLimitPerMinute,
      ))
    ) {
      return false;
    }
    return (
      (await this.trust.service.findExactReportReplay(userId, parsed.data)) !==
      null
    );
  }

  private async hit(
    key: string,
    max: number,
  ): Promise<boolean> {
    try {
      return await redisFixedWindowHit(
        this.redis.client,
        key,
        max,
      );
    } catch {
      if (
        this.config.appEnv === "local" ||
        this.config.appEnv === "test"
      ) {
        return memoryHit(key, max);
      }
      throw new HttpException(
        "Safety rate limiter unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function memoryHit(key: string, max: number): boolean {
  const now = Date.now();
  const current = memoryHits.get(key);
  if (!current || current.resetAt <= now) {
    memoryHits.set(key, {
      count: 1,
      resetAt: now + 60_000,
    });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}
