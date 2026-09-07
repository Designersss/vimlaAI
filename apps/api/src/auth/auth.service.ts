import { Inject, Injectable } from "@nestjs/common";
import { createVimlaAuthFromConfig, type VimlaAuth } from "@vimla/auth";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { RedisService } from "../persistence/redis.service.js";

@Injectable()
export class AuthService {
  readonly auth: VimlaAuth;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(RedisService) redis: RedisService,
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
  ) {
    this.auth = createVimlaAuthFromConfig(
      prisma.client,
      config,
      redis.client,
    );
  }
}
