import { Inject, Injectable, Logger } from "@nestjs/common";
import { EffectivePlanResolver } from "@vimla/billing";
import {
  MemoryError,
  MemoryService,
} from "@vimla/context";
import { ProjectService } from "@vimla/projects";
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
    const projects = new ProjectService(
      prisma.client,
      new EffectivePlanResolver(prisma.client),
      {
        tokenSecret: config.betterAuthSecret,
        webOrigin: config.webOrigin,
        inviteTtlDays: config.projectsInviteTtlDays,
      },
    );
    this.memory = new MemoryService(
      prisma.client,
      {
        canWriteProject: async ({
          actorUserId,
          projectId,
        }) => {
          const user = await prisma.client.user.findUnique({
            where: { id: actorUserId },
            select: { email: true },
          });
          if (!user) return false;
          try {
            const view = await projects.get(
              {
                userId: actorUserId,
                email: user.email,
              },
              projectId,
            );
            return view.capabilities.canEdit;
          } catch {
            return false;
          }
        },
      },
      config.memoryMaxActivePersonalItems,
    );
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
