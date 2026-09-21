import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import type {
  ExecutionPlanLookupView,
  ExecutionPlanView,
} from "./contracts.js";
import { OrchestrationService } from "./orchestration.service.js";

@Controller("v1/execution-plans")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard)
export class OrchestrationController {
  constructor(
    @Inject(OrchestrationService)
    private readonly orchestration: OrchestrationService,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ExecutionPlanView> {
    return this.orchestration.create(user.id, body);
  }

  @Get("by-message/:messageId")
  getForMessage(
    @AuthUser() user: AuthenticatedUser,
    @Param("messageId") messageId: string,
  ): Promise<ExecutionPlanLookupView> {
    return this.orchestration.getForMessage(user.id, messageId);
  }

  @Get(":id")
  getOne(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<ExecutionPlanView> {
    return this.orchestration.getOne(user.id, id);
  }

  @Post(":id/start")
  @HttpCode(200)
  start(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<ExecutionPlanView> {
    return this.orchestration.start(user.id, id);
  }

  @Post(":id/stop")
  @HttpCode(200)
  stop(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<ExecutionPlanView> {
    return this.orchestration.stop(user.id, id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ExecutionPlanView> {
    return this.orchestration.approve(user.id, id, body);
  }
}
