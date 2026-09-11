import { Inject, Injectable, Logger } from "@nestjs/common";
import { EffectivePlanResolver } from "@vimla/billing";
import { ProjectError, ProjectService, type ActorContext } from "@vimla/projects";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class ProjectsFacade {
  private readonly logger = new Logger(ProjectsFacade.name);
  readonly projects: ProjectService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {
    this.projects = new ProjectService(prisma.client, new EffectivePlanResolver(prisma.client), {
      tokenSecret: config.betterAuthSecret,
      webOrigin: config.webOrigin,
      inviteTtlDays: config.projectsInviteTtlDays,
    });
  }

  assertEnabled(): void {
    if (!this.config.projectsEnabled) {
      throw new ProjectError("DISABLED", "Projects are disabled");
    }
  }

  actor(user: { id: string; email: string }): ActorContext {
    return { userId: user.id, email: user.email };
  }

  logMutation(operation: string, userId: string, projectId?: string): void {
    this.logger.log({
      msg: "projects.mutate",
      operation,
      actorUserId: userId,
      projectId,
    });
  }
}
