import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  MemoryError,
  MemoryService,
} from "@vimla/context";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class MemoryFacade {
  private readonly logger = new Logger(MemoryFacade.name);
  readonly memory: MemoryService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {
    this.memory = new MemoryService(prisma.client);
  }

  assertEnabled(): void {
    if (!this.config.memoryEnabled) {
      throw new MemoryError("DISABLED", "Memory is disabled");
    }
  }

  assertE2eePromotionEnabled(): void {
    this.assertEnabled();
    if (!this.config.directChatsEnabled) {
      throw new MemoryError(
        "DISABLED",
        "E2EE memory promotion is disabled",
      );
    }
  }

  logMutation(
    operation: string,
    actorUserId: string,
    memoryId?: string,
  ): void {
    this.logger.log({
      msg: "memory.mutate",
      operation,
      actorUserId,
      memoryId: memoryId ?? null,
    });
  }
}
