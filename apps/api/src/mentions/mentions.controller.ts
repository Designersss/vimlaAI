import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  mentionSuggestionsQuerySchema,
  mentionSuggestionsResponseSchema,
  type MentionSuggestionsResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { MentionsService } from "./mentions.service.js";

@Controller("v1/mentions")
@UseGuards(AuthGuard)
export class MentionsController {
  constructor(@Inject(MentionsService) private readonly mentions: MentionsService) {}

  @Get()
  async suggest(
    @AuthUser() user: AuthenticatedUser,
    @Query() rawQuery: Record<string, unknown>,
  ): Promise<MentionSuggestionsResponse> {
    const parsed = mentionSuggestionsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ code: "validation_error", message: "Invalid mention query" });
    }
    const result = await this.mentions.suggest(user.id, parsed.data);
    return mentionSuggestionsResponseSchema.parse(result);
  }
}
