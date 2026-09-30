import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  syncCursorSchema,
  syncQuerySchema,
  syncResponseSchema,
  type SyncResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SyncService } from "./sync.service.js";

@Controller("v1/sync")
@UseGuards(AuthGuard, OriginGuard)
export class SyncController {
  constructor(
    @Inject(SyncService)
    private readonly sync: SyncService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async read(
    @AuthUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<SyncResponse> {
    if (
      !query ||
      typeof query !== "object"
    ) {
      throw invalidRequest();
    }

    const raw = query as Record<string, unknown>;
    if (raw.protocolVersion !== "1") {
      throw new BadRequestException({
        code: "sync_protocol_unsupported",
        message: "Unsupported sync protocol version",
      });
    }
    if (
      raw.cursor !== undefined &&
      !syncCursorSchema.safeParse(raw.cursor).success
    ) {
      throw new BadRequestException({
        code: "sync_cursor_invalid",
        message: "Sync cursor is invalid",
      });
    }

    const parsed = syncQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidRequest();
    }

    return syncResponseSchema.parse(
      await this.sync.read(user.id, {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      }),
    );
  }
}

function invalidRequest(): BadRequestException {
  return new BadRequestException({
    code: "validation_error",
    message: "Invalid sync request",
  });
}
