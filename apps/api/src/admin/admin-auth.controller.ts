import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminActor } from "@vimla/admin";
import { AuthGuard } from "../auth/auth.guard.js";
import { AdminGuard, AdminOriginGuard } from "./admin.guard.js";
import { AdminRateLimitGuard } from "./admin-rate-limit.guard.js";
import { RequireAdminPermission } from "./admin-permission.decorator.js";
import { AdminPermissionGuard } from "./admin-permission.guard.js";
import { AdminFacade } from "./admin.service.js";

const elevateSchema = z
  .object({
    totpCode: z.string().min(6).max(12).optional(),
    backupCode: z.string().min(6).max(32).optional(),
  })
  .strict();

@Controller("admin/v1/auth")
@UseGuards(AdminOriginGuard)
export class AdminAuthController {
  constructor(@Inject(AdminFacade) private readonly admin: AdminFacade) {}

  @Post("elevate")
  @UseGuards(AuthGuard, AdminRateLimitGuard)
  async elevate(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const parsed = elevateSchema.parse(body);
    return this.admin.elevate(request, reply, parsed);
  }

  @Get("me")
  @UseGuards(AdminGuard, AdminPermissionGuard)
  @RequireAdminPermission("security.audit.read")
  me(@Req() request: FastifyRequest) {
    return this.admin.current(request.adminActor as AdminActor);
  }

  @Post("logout")
  @UseGuards(AdminGuard, AdminPermissionGuard)
  @RequireAdminPermission("security.audit.read")
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.admin.logout(request.adminActor as AdminActor, reply);
  }

  @Post("step-up")
  @UseGuards(AdminGuard, AdminPermissionGuard, AuthGuard, AdminRateLimitGuard)
  @RequireAdminPermission("security.audit.read")
  async stepUp(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = elevateSchema.parse(body);
    await this.admin.verifyStrongFactor(request, parsed);
    const actor = request.adminActor as AdminActor;
    await this.admin.control.markStrongAuth(actor.sessionId);
    return { ok: true };
  }
}
