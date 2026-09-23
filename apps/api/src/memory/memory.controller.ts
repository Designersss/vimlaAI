import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  correctPersonalMemorySchema,
  createPersonalMemorySchema,
  listMemoriesQuerySchema,
  memoriesResponseSchema,
  memoryViewSchema,
  promoteE2eeMemorySchema,
  type MemoriesResponse,
  type MemoryView,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { MemoryFacade } from "./memory.facade.js";
import { MemoryRateLimitGuard } from "./memory-rate-limit.guard.js";

@Controller("v1/memory")
@SensitiveArea()
@UseGuards(
  AuthGuard,
  OriginGuard,
  SensitiveAreaGuard,
  MemoryRateLimitGuard,
)
export class MemoryController {
  constructor(
    @Inject(MemoryFacade)
    private readonly memory: MemoryFacade,
  ) {}

  @Get()
  async list(
    @AuthUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<MemoriesResponse> {
    this.memory.assertEnabled();
    const parsed = listMemoriesQuerySchema.parse(query ?? {});
    return memoriesResponseSchema.parse(
      await this.memory.memory.listPersonal(user.id, parsed),
    );
  }

  @Post()
  @HttpCode(201)
  async create(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<MemoryView> {
    this.memory.assertEnabled();
    const input = createPersonalMemorySchema.parse(body);
    const created = await this.memory.memory.rememberPersonal({
      actorUserId: user.id,
      type: input.type,
      slotKey: input.slotKey,
      content: input.content,
      expiresAt: input.expiresAt
        ? new Date(input.expiresAt)
        : null,
    });
    this.memory.logMutation(
      "memory.create",
      user.id,
      created.id,
    );
    return memoryViewSchema.parse(created);
  }

  @Post("e2ee-promotions")
  @HttpCode(201)
  async promoteE2ee(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<MemoryView> {
    this.memory.assertE2eePromotionEnabled();
    const input = promoteE2eeMemorySchema.parse(body);
    const created =
      await this.memory.memory.promoteE2eeDisclosure({
        actorUserId: user.id,
        directConversationId: input.directConversationId,
        sourceMessageId: input.sourceMessageId,
        type: input.type,
        slotKey: input.slotKey,
        content: input.content,
        expiresAt: input.expiresAt
          ? new Date(input.expiresAt)
          : null,
      });
    this.memory.logMutation(
      "memory.e2ee_promote",
      user.id,
      created.id,
    );
    return memoryViewSchema.parse(created);
  }

  @Get(":id")
  async getOne(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<MemoryView> {
    this.memory.assertEnabled();
    return memoryViewSchema.parse(
      await this.memory.memory.getPersonal(user.id, id),
    );
  }

  @Patch(":id")
  async correct(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MemoryView> {
    this.memory.assertEnabled();
    const input = correctPersonalMemorySchema.parse(body);
    const updated = await this.memory.memory.correctPersonal(
      user.id,
      id,
      {
        content: input.content,
        ...(input.expiresAt === undefined
          ? {}
          : {
              expiresAt:
                input.expiresAt === null
                  ? null
                  : new Date(input.expiresAt),
            }),
      },
    );
    this.memory.logMutation(
      "memory.correct",
      user.id,
      updated.id,
    );
    return memoryViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<void> {
    this.memory.assertEnabled();
    await this.memory.memory.invalidatePersonal(
      user.id,
      id,
    );
    this.memory.logMutation("memory.delete", user.id, id);
  }
}
