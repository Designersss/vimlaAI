import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { ProjectInvitesController, ProjectMembersController } from "./project-members.controller.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsFacade } from "./projects.facade.js";
import { ProjectsRateLimitGuard } from "./projects-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [ProjectsController, ProjectMembersController, ProjectInvitesController],
  providers: [ProjectsFacade, ProjectsRateLimitGuard],
  exports: [ProjectsFacade],
})
export class ProjectsModule {}
