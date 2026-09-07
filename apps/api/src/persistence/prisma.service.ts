import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, pingDatabase, type PrismaClient } from "@vimla/database";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  ping(): Promise<void> {
    return pingDatabase(this.client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
