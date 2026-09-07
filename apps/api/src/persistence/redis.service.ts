import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status === "wait") {
      await this.client.connect();
    }
  }

  async ping(): Promise<void> {
    if (this.client.status === "wait") {
      await this.client.connect();
    }

    const result = await this.client.ping();
    if (result !== "PONG") {
      throw new Error("Redis ping failed");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
