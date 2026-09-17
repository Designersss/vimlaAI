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
  isIanaTimeZone,
  updatePreferencesSchema,
  type CurrentUser,
} from "@vimla/contracts";
import type { AuthenticatedUser } from "@vimla/auth";
import { parseVimlaLocale } from "@vimla/shared";
import { PrismaService } from "../persistence/prisma.service.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AllowHandleOnboarding } from "./allow-handle-onboarding.decorator.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthUser } from "./current-user.decorator.js";
import { HandleService } from "./handle.service.js";
import { OriginGuard } from "./origin.guard.js";

@Controller("v1")
@AllowHandleOnboarding()
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(HandleService) private readonly handles: HandleService,
  ) {}

  @Get("me")
  async getMe(@AuthUser() user: AuthenticatedUser): Promise<CurrentUser> {
    await this.handles.activateVerified(user.id);
    const [preference, handle] = await Promise.all([
      this.readPreference(user.id),
      this.handles.readForUser(user.id),
    ]);
    return currentUserSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      handle: handle?.handle ?? null,
      handleStatus: handle?.status ?? null,
      handleRequired: handle === null,
      locale: parseVimlaLocale(preference?.locale, this.config.authDefaultLocale),
      timezone: preference?.timezone ?? null,
    });
  }

  @Patch("me/preferences")
  @UseGuards(OriginGuard)
  async updatePreferences(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CurrentUser> {
    const parsed = updatePreferencesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid preference payload");
    }

    if (parsed.data.timezone !== undefined && !isIanaTimeZone(parsed.data.timezone)) {
      throw new BadRequestException({
        code: "invalid_timezone",
        message: "Invalid timezone",
      });
    }

    await this.prisma.client.userPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        locale: parsed.data.locale ?? this.config.authDefaultLocale,
        timezone: parsed.data.timezone ?? null,
      },
      update: {
        ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
        ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
      },
    });

    return this.getMe(user);
  }

  private async readPreference(userId: string): Promise<{ locale: string; timezone: string | null } | null> {
    const preference = await this.prisma.client.userPreference.findUnique({
      where: { userId },
    });
    if (!preference) {
      return null;
    }
    return { locale: preference.locale, timezone: preference.timezone };
  }
}
