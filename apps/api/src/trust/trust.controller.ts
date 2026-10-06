import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  abuseReportReceiptSchema,
  blockedUsersQuerySchema,
  blockedUsersResponseSchema,
  blockUserSchema,
  createAbuseReportSchema,
  surfacePreferenceSchema,
  updateSurfacePreferenceSchema,
  userBlockStateSchema,
  type AbuseReportReceipt,
  type BlockedUsersResponse,
  type SurfacePreference,
  type UserBlockState,
} from "@vimla/contracts";
import { isTrustError } from "@vimla/trust";
import { z, type ZodType } from "zod";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveMutation } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { TrustFacade } from "./trust.facade.js";
import { TrustRateLimitGuard } from "./trust-rate-limit.guard.js";

@Controller("v1/trust")
@UseGuards(AuthGuard, TrustRateLimitGuard)
export class TrustController {
  constructor(
    @Inject(TrustFacade)
    private readonly trust: TrustFacade,
  ) {}

  @Get("blocks")
  async blocks(
    @AuthUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<BlockedUsersResponse> {
    const parsed = parseTrustRequest(
      blockedUsersQuerySchema,
      query,
      "Invalid blocked users query",
    );
    return blockedUsersResponseSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.listBlockedUsers(user.id, parsed),
      ),
    );
  }

  @Post("blocks")
  @HttpCode(200)
  @SensitiveMutation()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async block(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<UserBlockState> {
    const input = parseTrustRequest(
      blockUserSchema,
      body,
      "Invalid block payload",
    );
    return userBlockStateSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.blockUser(
          user.id,
          input.handle,
        ),
      ),
    );
  }

  @Delete("blocks/:handle")
  @HttpCode(200)
  @SensitiveMutation()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async unblock(
    @AuthUser() user: AuthenticatedUser,
    @Param("handle") handle: string,
  ): Promise<UserBlockState> {
    const input = parseTrustRequest(
      blockUserSchema,
      { handle },
      "Invalid blocked user handle",
    );
    return userBlockStateSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.unblockUser(
          user.id,
          input.handle,
        ),
      ),
    );
  }

  @Post("reports")
  @HttpCode(201)
  @SensitiveMutation()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async report(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<AbuseReportReceipt> {
    const input = parseTrustRequest(
      createAbuseReportSchema,
      body,
      "Invalid abuse report",
    );
    return abuseReportReceiptSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.createReport(user.id, input),
      ),
    );
  }

  @Get("surfaces/:surfaceId/preference")
  async preference(
    @AuthUser() user: AuthenticatedUser,
    @Param("surfaceId") surfaceId: string,
  ): Promise<SurfacePreference> {
    const id = parseSurfaceId(surfaceId);
    return surfacePreferenceSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.getSurfacePreference(
          user.id,
          id,
        ),
      ),
    );
  }

  @Patch("surfaces/:surfaceId/preference")
  @SensitiveMutation()
  @UseGuards(OriginGuard, SensitiveAreaGuard)
  async updatePreference(
    @AuthUser() user: AuthenticatedUser,
    @Param("surfaceId") surfaceId: string,
    @Body() body: unknown,
  ): Promise<SurfacePreference> {
    const id = parseSurfaceId(surfaceId);
    const input = parseTrustRequest(
      updateSurfacePreferenceSchema,
      body,
      "Invalid surface preference",
    );
    return surfacePreferenceSchema.parse(
      await withTrustErrors(() =>
        this.trust.service.updateSurfacePreference(
          user.id,
          id,
          input,
        ),
      ),
    );
  }
}

function parseSurfaceId(value: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_request",
      message: "Invalid communication surface id",
    });
  }
  return parsed.data;
}

function parseTrustRequest<T>(
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

async function withTrustErrors<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!isTrustError(error)) {
      throw error;
    }
    if (error.code === "NOT_FOUND") {
      throw new NotFoundException({
        code: "not_found",
        message: error.message,
      });
    }
    if (error.code === "FORBIDDEN") {
      throw new ForbiddenException({
        code: "forbidden",
        message: error.message,
      });
    }
    throw new BadRequestException({
      code:
        error.code === "EVIDENCE_INVALID"
          ? "invalid_evidence"
          : "invalid_request",
      message: error.message,
    });
  }
}
