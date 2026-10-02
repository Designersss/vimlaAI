import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  inboxResponseSchema,
  listInboxQuerySchema,
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
