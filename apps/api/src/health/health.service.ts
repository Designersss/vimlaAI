import type { HealthCheck, HealthResponse, HealthStatus } from "@vimla/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service.js";
import { RedisService } from "../persistence/redis.service.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.safeCheck(() => this.prisma.ping()),
      this.safeCheck(() => this.redis.ping()),
    ]);

    const api: HealthCheck = { status: "ok" };
    const status = aggregateStatus(api, database, redis);

    return {
      status,
      service: "api",
      checks: {
        api,
        database,
        redis,
      },
    };
  }

  private async safeCheck(ping: () => Promise<void>): Promise<HealthCheck> {
    try {
      await ping();
      return { status: "ok" };
    } catch (error: unknown) {
      return {
        status: "error",
        detail: error instanceof Error ? error.message : "unknown error",
      };
    }
  }
}

export function aggregateStatus(
  api: HealthCheck,
  database: HealthCheck,
  redis: HealthCheck,
): HealthStatus {
  if (api.status === "error") {
    return "error";
  }

  if (database.status === "error" || redis.status === "error") {
    return "degraded";
  }

  return "ok";
}
