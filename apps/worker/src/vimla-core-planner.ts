import { createHash, randomUUID } from "node:crypto";
import {
  LocalInferenceError,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderStreamEvent,
} from "@vimla/ai";
import {
  buildPlannerPrompt,
  parsePlannerOutput,
  type PlannerPlan,
} from "@vimla/operator";
import {
  VimlaPlannerError,
  type VimlaToolPlanner,
  type VimlaToolPlannerInput,
} from "./vimla-invocation-executor.js";

const FAIR_USE_WINDOW_MS = 60_000;
const MAX_PLANNER_RESPONSE_BYTES = 64 * 1024;

const FAIR_USE_ACQUIRE_SCRIPT = `
local rate = redis.call("INCR", KEYS[1])
if rate == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
if rate > tonumber(ARGV[2]) then
  return 0
end

local redisTime = redis.call("TIME")
local nowMs = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", nowMs)
if redis.call("ZCARD", KEYS[2]) >= tonumber(ARGV[4]) then
  return -1
end

local expiresAtMs = nowMs + tonumber(ARGV[3])
redis.call("ZADD", KEYS[2], expiresAtMs, ARGV[5])
redis.call("PEXPIRE", KEYS[2], ARGV[3])
return 1
`;

const FAIR_USE_RELEASE_SCRIPT = `
redis.call("ZREM", KEYS[1], ARGV[1])
if redis.call("ZCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
end
return 1
`;

export type RedisEval = (
  script: string,
  numberOfKeys: number,
  ...args: Array<string | number>
) => Promise<unknown>;

export interface VimlaCoreGateway {
  streamChat(request: ProviderChatRequest): Promise<ProviderChatResult>;
}

export interface VimlaCoreFairUseLease {
  release(): Promise<void>;
}

export interface VimlaCoreFairUseLimiter {
  acquire(actorUserId: string): Promise<VimlaCoreFairUseLease | null>;
}

export class RedisVimlaCoreFairUseLimiter
  implements VimlaCoreFairUseLimiter
{
  constructor(
    private readonly evalRedis: RedisEval,
    private readonly requestsPerMinute: number,
    private readonly maxConcurrentPerUser: number,
    private readonly leaseTtlMs: number,
  ) {
    positiveInteger(requestsPerMinute, "requestsPerMinute");
    positiveInteger(maxConcurrentPerUser, "maxConcurrentPerUser");
    positiveInteger(leaseTtlMs, "leaseTtlMs");
  }

  async acquire(actorUserId: string): Promise<VimlaCoreFairUseLease | null> {
    const suffix = createHash("sha256")
      .update(actorUserId)
      .digest("base64url")
      .slice(0, 32);
    const rateKey = `vimla:core:fair-use:{${suffix}}:rate`;
    const concurrentKey = `vimla:core:fair-use:{${suffix}}:concurrent`;
    const leaseId = randomUUID();
    const result = await this.evalRedis(
      FAIR_USE_ACQUIRE_SCRIPT,
      2,
      rateKey,
      concurrentKey,
      FAIR_USE_WINDOW_MS,
      this.requestsPerMinute,
      this.leaseTtlMs,
      this.maxConcurrentPerUser,
      leaseId,
    );
    if (Number(result) !== 1) return null;

    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.evalRedis(
          FAIR_USE_RELEASE_SCRIPT,
          1,
          concurrentKey,
          leaseId,
        );
      },
    };
  }
}

export class DisabledVimlaToolPlanner implements VimlaToolPlanner {
  async plan(_input: VimlaToolPlannerInput): Promise<PlannerPlan> {
    throw new VimlaPlannerError("VIMLA_CORE_DISABLED", false);
  }
}

export class LocalInferenceVimlaToolPlanner implements VimlaToolPlanner {
  constructor(
    private readonly gateway: VimlaCoreGateway,
    private readonly model: string,
    private readonly maxOutputTokens: number,
    private readonly fairUse: VimlaCoreFairUseLimiter,
  ) {
    if (!model.trim()) {
      throw new Error("Vimla Core model is required");
    }
    positiveInteger(maxOutputTokens, "maxOutputTokens");
  }

  async plan(input: VimlaToolPlannerInput): Promise<PlannerPlan> {
    let lease: VimlaCoreFairUseLease | null;
    try {
      lease = await this.fairUse.acquire(input.actorUserId);
    } catch {
      throw new VimlaPlannerError(
        "VIMLA_CORE_FAIR_USE_UNAVAILABLE",
        true,
      );
    }
    if (!lease) {
      throw new VimlaPlannerError("VIMLA_CORE_FAIR_USE_LIMIT", false);
    }

    try {
      const prompt = buildPlannerPrompt({
        userText: input.userText,
        locale: input.locale,
        snapshot: input.snapshot,
        invocationScope: "PERSONAL",
        untrustedContext: input.dependencyContext,
      });
      const result = await this.gateway.streamChat({
        providerModelId: this.model,
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: this.maxOutputTokens,
        correlationId: input.correlationId,
      });
      const raw = await collectPlannerText(result.events);
      return parsePlannerOutput(raw);
    } catch (error: unknown) {
      if (error instanceof LocalInferenceError) {
        throw new VimlaPlannerError(
          `VIMLA_CORE_${error.code}`,
          error.retryable,
        );
      }
      throw error;
    } finally {
      try {
        await lease.release();
      } catch {
        // The lease has an expiry; a release failure must not authorize
        // additional work or hide the planner's primary result/error.
      }
    }
  }
}

async function collectPlannerText(
  events: AsyncIterable<ProviderStreamEvent>,
): Promise<string> {
  const chunks: string[] = [];
  let bytes = 0;
  for await (const event of events) {
    if (event.type === "tool_call_delta") {
      throw new VimlaPlannerError(
        "VIMLA_CORE_UNEXPECTED_TOOL_CALL",
        false,
      );
    }
    if (event.type !== "delta") continue;
    bytes += new TextEncoder().encode(event.text).byteLength;
    if (bytes > MAX_PLANNER_RESPONSE_BYTES) {
      throw new VimlaPlannerError(
        "VIMLA_CORE_RESPONSE_TOO_LARGE",
        false,
      );
    }
    chunks.push(event.text);
  }
  return chunks.join("");
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}
