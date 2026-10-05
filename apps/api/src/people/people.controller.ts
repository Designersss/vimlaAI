import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  peopleSearchQuerySchema,
  peopleSearchResponseSchema,
  publicProfileHandleParamsSchema,
  publicProfileSchema,
  updatePublicProfileSchema,
  type PublicProfile,
} from "@vimla/contracts/public-profiles";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { PeopleRateLimitGuard } from "./people-rate-limit.guard.js";
import { PeopleService } from "./people.service.js";

@Controller("v1/people")
@UseGuards(AuthGuard, PeopleRateLimitGuard)
export class PeopleController {
  constructor(@Inject(PeopleService) private readonly people: PeopleService) {}

  @Get()
  async search(
    @AuthUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<{ items: PublicProfile[] }> {
    const input = peopleSearchQuerySchema.parse(query);
    return peopleSearchResponseSchema.parse({
      items: await this.people.search(user.id, input.q, input.limit),
    });
  }

  @Get(":handle")
  async getByHandle(
    @AuthUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<PublicProfile> {
    const { handle } = publicProfileHandleParamsSchema.parse(params);
    const profile = await this.people.getByHandle(user.id, handle);
    if (!profile) {
      throw new NotFoundException({ code: "not_found", message: "Profile was not found" });
    }
    return publicProfileSchema.parse(profile);
  }

  @Patch("me")
  @SensitiveArea()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async updateMine(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PublicProfile> {
    const input = updatePublicProfileSchema.parse(body);
    const profile = await this.people.updateMine(user.id, input);
    if (!profile) {
      throw new NotFoundException({ code: "not_found", message: "Profile was not found" });
    }
    return publicProfileSchema.parse(profile);
  }
}
