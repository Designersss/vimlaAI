import { Controller, Get, UseGuards } from "@nestjs/common";
import { currentUserSchema, type CurrentUser } from "@vimla/contracts";
import type { AuthenticatedUser } from "@vimla/auth";
import { AuthGuard } from "./auth.guard.js";
import { AuthUser } from "./current-user.decorator.js";

@Controller("v1")
export class MeController {
  @Get("me")
  @UseGuards(AuthGuard)
  getMe(@AuthUser() user: AuthenticatedUser): CurrentUser {
    return currentUserSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    });
  }
}
