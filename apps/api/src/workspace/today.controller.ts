import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import { workspaceTodayResponseSchema, type WorkspaceTodayResponse } from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Controller("v1/workspace/today")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, WorkspaceRateLimitGuard)
export class WorkspaceTodayController {
  constructor(@Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade) {}

  @Get()
  async getToday(@AuthUser() user: AuthenticatedUser): Promise<WorkspaceTodayResponse> {
    const timezone = await this.workspace.storedTimezone(user.id);
    return workspaceTodayResponseSchema.parse(
      await this.workspace.today.get(this.workspace.actor(user.id), timezone),
    );
  }
}
