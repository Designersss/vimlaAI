import {
  BadRequestException,
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
import type { ZodType } from "zod";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveMutation } from "../auth/sensitive-area.js";
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
    const input = parsePeopleRequest(
      peopleSearchQuerySchema,
      query,
      "Invalid People search query",
    );
    return peopleSearchResponseSchema.parse({
      items: await this.people.search(user.id, input.q, input.limit),
    });
  }

  @Get(":handle")
  async getByHandle(
    @AuthUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<PublicProfile> {
    const { handle } = parsePeopleRequest(
      publicProfileHandleParamsSchema,
      params,
      "Invalid public profile handle",
    );
    const profile = await this.people.getByHandle(user.id, handle);
    if (!profile) {
      throw new NotFoundException({ code: "not_found", message: "Profile was not found" });
    }
    return publicProfileSchema.parse(profile);
  }

  @Patch("me")
  @SensitiveMutation()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async updateMine(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PublicProfile> {
    const input = parsePeopleRequest(
      updatePublicProfileSchema,
      body,
      "Invalid public profile payload",
    );
    const profile = await this.people.updateMine(user.id, input);
    if (!profile) {
      throw new NotFoundException({ code: "not_found", message: "Profile was not found" });
    }
    return publicProfileSchema.parse(profile);
  }
}

function parsePeopleRequest<T>(
  schema: ZodType<T>,
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_request",
      message,
    });
  }
  return parsed.data;
}
