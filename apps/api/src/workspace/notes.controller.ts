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
  createNoteSchema,
  listNotesQuerySchema,
  noteViewSchema,
  notesResponseSchema,
  updateNoteSchema,
  type NoteView,
  type NotesResponse,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { archivedFlag, parseRequest } from "./http.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Controller("v1/workspace/notes")
@SensitiveArea()
@UseGuards(AuthGuard, OriginGuard, SensitiveAreaGuard, WorkspaceRateLimitGuard)
export class WorkspaceNotesController {
  constructor(@Inject(WorkspaceFacade) private readonly workspace: WorkspaceFacade) {}

  @Post()
  @HttpCode(201)
  async create(@AuthUser() user: AuthenticatedUser, @Body() body: unknown): Promise<NoteView> {
    const input = parseRequest(createNoteSchema, body, "Invalid note payload");
    const created = await this.workspace.notes.create(this.workspace.actor(user.id), input);
    this.workspace.logMutation("note.create", user.id, "NOTE", created.id);
    return noteViewSchema.parse(created);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser, @Query() query: unknown): Promise<NotesResponse> {
    const parsed = parseRequest(listNotesQuerySchema, query, "Invalid note query");
    const page = await this.workspace.notes.list(this.workspace.actor(user.id), {
      limit: parsed.limit,
      cursor: parsed.cursor,
      archived: archivedFlag(parsed.archived),
      q: parsed.q,
      pinned: parsed.pinned === "true",
    });
    return notesResponseSchema.parse(page);
  }

  @Get(":id")
  async getOne(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<NoteView> {
    return noteViewSchema.parse(await this.workspace.notes.get(this.workspace.actor(user.id), id));
  }

  @Patch(":id")
  async update(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<NoteView> {
    const input = parseRequest(updateNoteSchema, body, "Invalid note payload");
    const updated = await this.workspace.notes.update(this.workspace.actor(user.id), id, input);
    this.workspace.logMutation("note.update", user.id, "NOTE", id);
    return noteViewSchema.parse(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@AuthUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    await this.workspace.notes.delete(this.workspace.actor(user.id), id);
    this.workspace.logMutation("note.delete", user.id, "NOTE", id);
  }
}
