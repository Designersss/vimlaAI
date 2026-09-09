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
  createListItemSchema,
  createListSchema,
  listListsQuerySchema,
  listViewSchema,
  listsResponseSchema,
  reorderListItemsSchema,
  updateListItemSchema,
  updateListSchema,
  type ListView,
  type ListsResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { archivedFlag, parseRequest } from "./http.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Controller("v1/workspace/lists")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, WorkspaceRateLimitGuard)
export class WorkspaceListsController {
  constructor(@Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ListView> {
    const input = parseRequest(createListSchema, body, "Invalid list payload");
    const created = await this.workspace.lists.create(this.workspace.actor(user.id), input);
    this.workspace.logMutation("list.create", user.id, "LIST", created.id);
    return listViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<ListsResponse> {
    const parsed = parseRequest(listListsQuerySchema, query, "Invalid list query");
    const page = await this.workspace.lists.list(this.workspace.actor(user.id), {
      limit: parsed.limit,
      cursor: parsed.cursor,
      archived: archivedFlag(parsed.archived),
      type: parsed.type,
    });
    return listsResponseSchema.parse(page);
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<ListView> {
    return listViewSchema.parse(await this.workspace.lists.get(this.workspace.actor(user.id), id));
  }

  @Patch(":id")
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ListView> {
    const input = parseRequest(updateListSchema, body, "Invalid list payload");
    const updated = await this.workspace.lists.update(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("list.update", user.id, "LIST", id);
    return listViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    await this.workspace.lists.delete(this.workspace.actor(user.id), id);
    this.workspace.logMutation("list.delete", user.id, "LIST", id);
  }

  @Post(":id/items")
  @HttpCode(201)
  async addItem(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ListView> {
    const input = parseRequest(createListItemSchema, body, "Invalid list item payload");
    const updated = await this.workspace.lists.addItem(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("list.item.create", user.id, "LIST", id);
    return listViewSchema.parse(updated);
  }

  @Patch(":id/items/:itemId")
  async updateItem(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<ListView> {
    const input = parseRequest(updateListItemSchema, body, "Invalid list item payload");
    const updated = await this.workspace.lists.updateItem(this.workspace.actor(user.id), id, itemId, input);
    this.workspace.logMutation("list.item.update", user.id, "LIST", id);
    return listViewSchema.parse(updated);
  }

  @Delete(":id/items/:itemId")
  async deleteItem(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
  ): Promise<ListView> {
    const updated = await this.workspace.lists.deleteItem(this.workspace.actor(user.id), id, itemId);
    this.workspace.logMutation("list.item.delete", user.id, "LIST", id);
    return listViewSchema.parse(updated);
  }

  @Post(":id/reorder")
  async reorder(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ListView> {
    const input = parseRequest(reorderListItemsSchema, body, "Invalid reorder payload");
    const updated = await this.workspace.lists.reorder(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("list.reorder", user.id, "LIST", id);
    return listViewSchema.parse(updated);
  }
}
