import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "@vimla/auth";
import type { OperatorConversation, OperatorRunView } from "@vimla/contracts";
import { operatorConversationSchema } from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { OperatorService } from "./operator.service.js";
import { OperatorRateLimitGuard } from "./operator-rate-limit.guard.js";

@Controller("v1/operator")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard)
export class OperatorThreadController {
  constructor(@Inject(OperatorService) private readonly operator: OperatorService) {}

  @Get("conversation")
  async conversation(@AuthUser() user: AuthenticatedUser): Promise<OperatorConversation> {
    return operatorConversationSchema.parse(await this.operator.getOperatorConversation(user.id));
  }
}

@Controller("v1/operator/runs")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, OperatorRateLimitGuard)
export class OperatorRunsController {
  constructor(@Inject(OperatorService) private readonly operator: OperatorService) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown, @Req() request: FastifyRequest): Promise<OperatorRunView> {
    return this.operator.createRun(user.id, body, String(request.id));
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<OperatorRunView> {
    return this.operator.getRun(user.id, id);
  }

  @Post(":id/confirm")
  @HttpCode(200)
  async confirm(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatorRunView> {
    return this.operator.confirmRun(user.id, id, body, String(request.id));
  }

  @Post(":id/continue")
  @HttpCode(200)
  async continueRun(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatorRunView> {
    return this.operator.continueRun(user.id, id, body, String(request.id));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  async cancel(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<OperatorRunView> {
    return this.operator.cancelRun(user.id, id);
  }
}
