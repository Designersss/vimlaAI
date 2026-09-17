import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { claimHandleSchema, handleInputSchema } from "@vimla/contracts";
import type { AuthenticatedUser } from "@vimla/auth";
import { AllowHandleOnboarding } from "./allow-handle-onboarding.decorator.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthUser } from "./current-user.decorator.js";
import { HandleService } from "./handle.service.js";
import { OriginGuard } from "./origin.guard.js";

@Controller("v1/handles")
export class HandleController {
  constructor(private readonly handles: HandleService) {}

  @Get("availability")
  async availability(@Query("handle") rawHandle?: string) {
    const parsed = handleInputSchema.safeParse(rawHandle ?? "");
    if (!parsed.success) {
      throw new BadRequestException({ code: "validation_error", message: "Invalid handle" });
    }
    return this.handles.availability(parsed.data);
  }

  @Post("claim")
  @AllowHandleOnboarding()
  @UseGuards(AuthGuard, OriginGuard)
  async claim(@AuthUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = claimHandleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "validation_error", message: "Invalid handle" });
    }
    return this.handles.claim(user.id, parsed.data.handle);
  }
}
