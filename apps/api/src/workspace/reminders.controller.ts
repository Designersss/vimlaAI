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
  createReminderSchema,
  listRemindersQuerySchema,
  reminderViewSchema,
  remindersResponseSchema,
  updateReminderSchema,
  type ReminderView,
  type RemindersResponse,
} from "@vimla/contracts";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { archivedFlag, parseRequest } from "./http.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Controller("v1/workspace/reminders")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, WorkspaceRateLimitGuard)
export class WorkspaceRemindersController {
  constructor(
    @Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ReminderView> {
    const input = parseRequest(createReminderSchema, body, "Invalid reminder payload");
    const stored = await this.workspace.storedTimezone(user.id);
    const timezone = this.workspace.reminderTimezoneOrThrow(stored, input.timezone);
    if (input.timezone && !stored) {
      await this.workspace.persistConfirmedTimezone(user.id, input.timezone, this.config.authDefaultLocale);
    }
    const created = await this.workspace.reminders.create(this.workspace.actor(user.id), input, { timezone });
    this.workspace.logMutation("reminder.create", user.id, "REMINDER", created.id);
    return reminderViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<RemindersResponse> {
    const parsed = parseRequest(listRemindersQuerySchema, query, "Invalid reminder query");
    const page = await this.workspace.reminders.list(this.workspace.actor(user.id), {
      limit: parsed.limit,
      cursor: parsed.cursor,
      archived: archivedFlag(parsed.archived),
      status: parsed.status,
    });
    return remindersResponseSchema.parse(page);
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<ReminderView> {
    return reminderViewSchema.parse(await this.workspace.reminders.get(this.workspace.actor(user.id), id));
  }

  @Patch(":id")
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ReminderView> {
    const input = parseRequest(updateReminderSchema, body, "Invalid reminder payload");
    const updated = await this.workspace.reminders.update(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("reminder.update", user.id, "REMINDER", id);
    return reminderViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    await this.workspace.reminders.delete(this.workspace.actor(user.id), id);
    this.workspace.logMutation("reminder.delete", user.id, "REMINDER", id);
  }
}
