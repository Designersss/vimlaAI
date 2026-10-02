import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  communicationSurfaceIdSchema,
  inboxItemSchema,
  inboxResponseSchema,
  listInboxQuerySchema,
  type InboxItem,
  type InboxResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { InboxService } from "./inbox.service.js";

@Controller("v1/inbox")
@SensitiveArea()
@UseGuards(
  AuthGuard,
  OriginGuard,
  SensitiveAreaGuard,
)
export class InboxController {
  constructor(
    @Inject(InboxService)
    private readonly inbox: InboxService,
  ) {}

  @Get(":surfaceId")
  async getOne(
    @AuthUser() user: AuthenticatedUser,
    @Param("surfaceId") surfaceId: string,
  ): Promise<InboxItem> {
    const parsed =
      communicationSurfaceIdSchema.safeParse(
        surfaceId,
      );
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid communication surface id",
      );
    }
    const item = await this.inbox.get(
      user.id,
      parsed.data,
    );
    if (!item) {
      throw new NotFoundException(
        "Communication surface was not found",
      );
    }
    return inboxItemSchema.parse(item);
  }

  @Get()
  async list(
    @AuthUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<InboxResponse> {
    const parsed =
      listInboxQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid inbox query",
      );
    }
    return inboxResponseSchema.parse(
      await this.inbox.list(
        user.id,
        parsed.data,
      ),
    );
  }
}
