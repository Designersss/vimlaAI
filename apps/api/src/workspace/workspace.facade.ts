import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ListService,
  NoteService,
  ReminderService,
  TaskService,
  WorkspaceError,
  WorkspaceTodayService,
  type ActorContext,
} from "@vimla/workspace";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class WorkspaceFacade {
  private readonly logger = new Logger(WorkspaceFacade.name);
  readonly tasks: TaskService;
  readonly reminders: ReminderService;
  readonly lists: ListService;
  readonly notes: NoteService;
  readonly today: WorkspaceTodayService;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const db = this.prisma.client;
    this.tasks = new TaskService(db);
    this.reminders = new ReminderService(db);
    this.lists = new ListService(db);
    this.notes = new NoteService(db);
    this.today = new WorkspaceTodayService(db);
  }

  actor(userId: string): ActorContext {
    return { userId };
  }

  logMutation(operation: string, userId: string, kind: string, objectId?: string): void {
    this.logger.log({
      msg: "workspace.mutate",
      operation,
      actorUserId: userId,
      kind,
      objectId,
    });
  }

  async storedTimezone(userId: string): Promise<string | null> {
    const preference = await this.prisma.client.userPreference.findUnique({
      where: { userId },
    });
    return preference?.timezone ?? null;
  }

  async persistConfirmedTimezone(userId: string, timezone: string, defaultLocale: string): Promise<void> {
    const existing = await this.prisma.client.userPreference.findUnique({
      where: { userId },
    });
    if (existing?.timezone) {
      return;
    }
    await this.prisma.client.userPreference.upsert({
      where: { userId },
      create: { userId, locale: defaultLocale, timezone },
      update: { timezone },
    });
  }

  reminderTimezoneOrThrow(stored: string | null, requested: string | undefined): string {
    const timezone = requested ?? stored;
    if (!timezone) {
      throw new WorkspaceError("TIMEZONE_REQUIRED", "Timezone is required before scheduling a reminder");
    }
    return timezone;
  }
}
