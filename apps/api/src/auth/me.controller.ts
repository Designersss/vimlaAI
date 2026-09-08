import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from "@nestjs/common";
import {
  currentUserSchema,
  updateLocalePreferenceSchema,
  type CurrentUser,
} from "@vimla/contracts";
import type { AuthenticatedUser } from "@vimla/auth";
import { parseVimlaLocale, type VimlaLocale } from "@vimla/shared";
import { PrismaService } from "../persistence/prisma.service.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthUser } from "./current-user.decorator.js";

@Controller("v1")
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {}

  @Get("me")
  async getMe(@AuthUser() user: AuthenticatedUser): Promise<CurrentUser> {
    const locale = await this.readLocale(user.id);
    return currentUserSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
      locale,
    });
  }

  @Patch("me/preferences")
  async updatePreferences(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CurrentUser> {
    const parsed = updateLocalePreferenceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid preference payload");
    }

    await this.prisma.client.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, locale: parsed.data.locale },
      update: { locale: parsed.data.locale },
    });

    return this.getMe(user);
  }

  private async readLocale(userId: string): Promise<VimlaLocale> {
    const preference = await this.prisma.client.userPreference.findUnique({
      where: { userId },
    });
    return parseVimlaLocale(preference?.locale, this.config.authDefaultLocale);
  }
}
