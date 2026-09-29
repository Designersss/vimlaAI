import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  clientInstallationIdSchema,
  clientInstallationViewSchema,
  clientInstallationsResponseSchema,
  registerClientInstallationSchema,
  updateClientInstallationPreferencesSchema,
  type ClientInstallationView,
  type ClientInstallationsResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { ClientInstallationsRateLimitGuard } from "./client-installations-rate-limit.guard.js";
import { ClientInstallationsService } from "./client-installations.service.js";

@Controller("v1/client-installations")
@SensitiveArea()
@UseGuards(
  AuthGuard,
  OriginGuard,
  SensitiveAreaGuard,
  ClientInstallationsRateLimitGuard,
)
export class ClientInstallationsController {
  constructor(
    @Inject(ClientInstallationsService)
    private readonly installations: ClientInstallationsService,
  ) {}

  @Post("register")
  @HttpCode(200)
  async register(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ClientInstallationView> {
    const input = registerClientInstallationSchema.safeParse(body);
    if (!input.success) {
      throw invalidPayload();
    }
    return clientInstallationViewSchema.parse(
      await this.installations.register(user.id, input.data),
    );
  }

  @Get()
  async list(
    @AuthUser() user: AuthenticatedUser,
  ): Promise<ClientInstallationsResponse> {
    return clientInstallationsResponseSchema.parse({
      items: await this.installations.list(user.id),
    });
  }

  @Post(":id/revoke")
  @HttpCode(200)
  async revoke(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<ClientInstallationView> {
    if (!clientInstallationIdSchema.safeParse(id).success) {
      throw invalidPayload();
    }
    return clientInstallationViewSchema.parse(
      await this.installations.revoke(user.id, id),
    );
  }

  @Patch(":id/preferences")
  async updatePreferences(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ClientInstallationView> {
    if (!clientInstallationIdSchema.safeParse(id).success) {
      throw invalidPayload();
    }
    const input =
      updateClientInstallationPreferencesSchema.safeParse(body);
    if (!input.success) {
      throw invalidPayload();
    }
    return clientInstallationViewSchema.parse(
      await this.installations.updatePreferences(
        user.id,
        id,
        input.data,
      ),
    );
  }
}

function invalidPayload(): BadRequestException {
  return new BadRequestException({
    code: "validation_error",
    message: "Invalid client installation payload",
  });
}
