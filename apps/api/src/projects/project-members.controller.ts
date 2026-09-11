import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  createProjectInviteSchema,
  projectInviteViewSchema,
  projectInvitesResponseSchema,
  projectMembersResponseSchema,
  projectRoleUpdateSchema,
  type ProjectInviteView,
  type ProjectInvitesResponse,
  type ProjectMembersResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { parseRequest } from "./http.js";
import { ProjectsFacade } from "./projects.facade.js";
import { ProjectsRateLimitGuard } from "./projects-rate-limit.guard.js";

@Controller("v1/projects/:projectId/members")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, ProjectsRateLimitGuard)
export class ProjectMembersController {
  constructor(@Inject(ProjectsFacade) private readonly projects: ProjectsFacade) {}

  @Get()
  async list(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ): Promise<ProjectMembersResponse> {
    this.projects.assertEnabled();
    const items = await this.projects.projects.listMembers(this.projects.actor(user), projectId);
    return projectMembersResponseSchema.parse({ items });
  }

  @Patch(":userId")
  async updateRole(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ): Promise<ProjectMembersResponse> {
    this.projects.assertEnabled();
    const input = parseRequest(projectRoleUpdateSchema, body, "Invalid member role payload");
    const items = await this.projects.projects.updateMemberRole(
      this.projects.actor(user),
      projectId,
      userId,
      input.role,
    );
    this.projects.logMutation("project.member.role", user.id, projectId);
    return projectMembersResponseSchema.parse({ items });
  }

  @Delete(":userId")
  @HttpCode(204)
  async remove(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ): Promise<void> {
    this.projects.assertEnabled();
    await this.projects.projects.removeMember(this.projects.actor(user), projectId, userId);
    this.projects.logMutation("project.member.remove", user.id, projectId);
  }
}

@Controller("v1/projects/:projectId/invites")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, ProjectsRateLimitGuard)
export class ProjectInvitesController {
  constructor(@Inject(ProjectsFacade) private readonly projects: ProjectsFacade) {}

  @Post()
  @HttpCode(201)
  async create(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<ProjectInviteView> {
    this.projects.assertEnabled();
    const input = parseRequest(createProjectInviteSchema, body, "Invalid invite payload");
    const created = await this.projects.projects.invite(this.projects.actor(user), projectId, input);
    this.projects.logMutation("project.invite.create", user.id, projectId);
    return projectInviteViewSchema.parse(created);
  }

  @Get()
  async list(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ): Promise<ProjectInvitesResponse> {
    this.projects.assertEnabled();
    const items = await this.projects.projects.listInvites(this.projects.actor(user), projectId);
    return projectInvitesResponseSchema.parse({ items });
  }

  @Delete(":inviteId")
  @HttpCode(204)
  async revoke(
    @AuthUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("inviteId") inviteId: string,
  ): Promise<void> {
    this.projects.assertEnabled();
    await this.projects.projects.revokeInvite(this.projects.actor(user), projectId, inviteId);
    this.projects.logMutation("project.invite.revoke", user.id, projectId);
  }
}
