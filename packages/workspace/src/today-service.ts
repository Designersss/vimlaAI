import type { ReminderView, TaskView, WorkspaceTodayResponse } from "@vimla/contracts";
import { zonedDayBounds } from "./timezone.js";
import type { ActorContext, DbClient } from "./types.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export class WorkspaceTodayService {
  constructor(private readonly db: DbClient) {}

  async get(actor: ActorContext, timezone: string | null, now: Date = new Date()): Promise<WorkspaceTodayResponse> {
    if (!timezone) {
      return {
        timezone: null,
        overdueTasks: [],
        todayTasks: [],
        todayReminders: [],
        counts: { overdueTasks: 0, todayTasks: 0, todayReminders: 0 },
      };
    }
    const { start, end } = zonedDayBounds(now, timezone);
    const [overdueRows, todayTaskRows, reminderRows] = await Promise.all([
      this.db.workspaceObject.findMany({
        where: {
          personalOwnerUserId: actor.userId,
          kind: "TASK",
          deletedAt: null,
          archivedAt: null,
          task: { is: { status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: start } } },
        },
        include: { task: true },
        orderBy: { task: { dueAt: "asc" } },
        take: 50,
      }),
      this.db.workspaceObject.findMany({
        where: {
          personalOwnerUserId: actor.userId,
          kind: "TASK",
          deletedAt: null,
          archivedAt: null,
          task: { is: { status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { gte: start, lt: end } } },
        },
        include: { task: true },
        orderBy: { task: { dueAt: "asc" } },
        take: 50,
      }),
      this.db.workspaceObject.findMany({
        where: {
          personalOwnerUserId: actor.userId,
          kind: "REMINDER",
          deletedAt: null,
          archivedAt: null,
          reminder: { is: { status: "PENDING", scheduledAt: { gte: start, lt: end } } },
        },
        include: { reminder: true },
        orderBy: { reminder: { scheduledAt: "asc" } },
        take: 50,
      }),
    ]);

    const overdueTasks = overdueRows.flatMap((row): TaskView[] =>
      row.task
        ? [
            {
              id: row.id,
              kind: "TASK",
              title: row.task.title,
              description: row.task.description,
              status: row.task.status as TaskView["status"],
              priority: row.task.priority as TaskView["priority"],
              dueAt: iso(row.task.dueAt),
              completedAt: iso(row.task.completedAt),
              archivedAt: iso(row.archivedAt),
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
              assignedByUserId: row.task.assignedByUserId,
              assignedByName: null,
            },
          ]
        : [],
    );
    const todayTasks = todayTaskRows.flatMap((row): TaskView[] =>
      row.task
        ? [
            {
              id: row.id,
              kind: "TASK",
              title: row.task.title,
              description: row.task.description,
              status: row.task.status as TaskView["status"],
              priority: row.task.priority as TaskView["priority"],
              dueAt: iso(row.task.dueAt),
              completedAt: iso(row.task.completedAt),
              archivedAt: iso(row.archivedAt),
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
              assignedByUserId: row.task.assignedByUserId,
              assignedByName: null,
            },
          ]
        : [],
    );
    const todayReminders = reminderRows.flatMap((row): ReminderView[] =>
      row.reminder
        ? [
            {
              id: row.id,
              kind: "REMINDER",
              title: row.reminder.title,
              description: row.reminder.description,
              scheduledAt: row.reminder.scheduledAt.toISOString(),
              timezone: row.reminder.timezone,
              status: row.reminder.status as ReminderView["status"],
              linkedTaskId: row.reminder.linkedTaskObjectId,
              archivedAt: iso(row.archivedAt),
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            },
          ]
        : [],
    );

    return {
      timezone,
      overdueTasks,
      todayTasks,
      todayReminders,
      counts: {
        overdueTasks: overdueTasks.length,
        todayTasks: todayTasks.length,
        todayReminders: todayReminders.length,
      },
    };
  }
}
