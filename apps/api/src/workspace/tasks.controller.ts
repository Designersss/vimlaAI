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
  createTaskSchema,
  listTasksQuerySchema,
  taskViewSchema,
  tasksResponseSchema,
  updateTaskSchema,
  type TaskView,
  type TasksResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { archivedFlag, parseRequest } from "./http.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Controller("v1/workspace/tasks")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, WorkspaceRateLimitGuard)
export class WorkspaceTasksController {
  constructor(@Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<TaskView> {
    const input = parseRequest(createTaskSchema, body, "Invalid task payload");
    const created = await this.workspace.tasks.create(this.workspace.actor(user.id), input);
    this.workspace.logMutation("task.create", user.id, "TASK", created.id);
    return taskViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<TasksResponse> {
    const parsed = parseRequest(listTasksQuerySchema, query, "Invalid task query");
    const page = await this.workspace.tasks.list(this.workspace.actor(user.id), {
      limit: parsed.limit,
      cursor: parsed.cursor,
      archived: archivedFlag(parsed.archived),
      status: parsed.status,
      dueFrom: parsed.dueFrom,
      dueTo: parsed.dueTo,
    });
    return tasksResponseSchema.parse(page);
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<TaskView> {
    return taskViewSchema.parse(await this.workspace.tasks.get(this.workspace.actor(user.id), id));
  }

  @Patch(":id")
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<TaskView> {
    const input = parseRequest(updateTaskSchema, body, "Invalid task payload");
    const updated = await this.workspace.tasks.update(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("task.update", user.id, "TASK", id);
    return taskViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    await this.workspace.tasks.delete(this.workspace.actor(user.id), id);
    this.workspace.logMutation("task.delete", user.id, "TASK", id);
  }
}
