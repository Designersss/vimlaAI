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
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  acceptProjectInviteSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  projectViewSchema,
  projectsResponseSchema,
  updateProjectSchema,
  type ProjectView,
  type ProjectsResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { parseRequest } from "./http.js";
import { ProjectsFacade } from "./projects.facade.js";
import { ProjectsRateLimitGuard } from "./projects-rate-limit.guard.js";

@Controller("v1/projects")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, ProjectsRateLimitGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsFacade) private readonly projects: ProjectsFacade) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ProjectView> {
    this.projects.assertEnabled();
    const input = parseRequest(createProjectSchema, body, "Invalid project payload");
    const created = await this.projects.projects.create(this.projects.actor(user), input);
    this.projects.logMutation("project.create", user.id, created.id);
    return projectViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<ProjectsResponse> {
    this.projects.assertEnabled();
    const parsed = parseRequest(listProjectsQuerySchema, query, "Invalid project query");
    const page = await this.projects.projects.list(this.projects.actor(user), {
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return projectsResponseSchema.parse(page);
  }

  @Post("invites/accept")
  @HttpCode(200)
  async acceptInvite(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ProjectView> {
    this.projects.assertEnabled();
    const input = parseRequest(acceptProjectInviteSchema, body, "Invalid invite payload");
    const joined = await this.projects.projects.acceptInvite(this.projects.actor(user), input.token);
    this.projects.logMutation("project.invite.accept", user.id, joined.id);
    return projectViewSchema.parse(joined);
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<ProjectView> {
    this.projects.assertEnabled();
    return projectViewSchema.parse(await this.projects.projects.get(this.projects.actor(user), id));
  }

  @Post(":id/open")
  @HttpCode(200)
  async open(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<ProjectView> {
    this.projects.assertEnabled();
    const opened = await this.projects.projects.open(this.projects.actor(user), id);
    this.projects.logMutation("project.open", user.id, id);
    return projectViewSchema.parse(opened);
  }

  @Patch(":id")
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ProjectView> {
    this.projects.assertEnabled();
    const input = parseRequest(updateProjectSchema, body, "Invalid project payload");
    const updated = await this.projects.projects.update(this.projects.actor(user), id, input);
    this.projects.logMutation("project.update", user.id, id);
    return projectViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    this.projects.assertEnabled();
    await this.projects.projects.delete(this.projects.actor(user), id);
    this.projects.logMutation("project.delete", user.id, id);
  }

  @Post(":id/leave")
  @HttpCode(204)
  async leave(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    this.projects.assertEnabled();
    await this.projects.projects.leave(this.projects.actor(user), id);
    this.projects.logMutation("project.leave", user.id, id);
  }
}
