import type {
  ActorContext,
  ListService,
  NoteService,
  ReminderService,
  TaskService,
  TrustedSourceContext,
  WorkspaceTodayService,
} from "@vimla/workspace";
import type { NotificationPreferenceService } from "@vimla/notifications";
import type { OperatorActionCard } from "@vimla/contracts";

export interface SafeProfile {
  name: string;
  locale: string;
  timezone: string | null;
  emailVerified: boolean;
}

export interface OperatorToolServices {
  tasks: TaskService;
  reminders: ReminderService;
  lists: ListService;
  notes: NoteService;
  today: WorkspaceTodayService;
  notifications: NotificationPreferenceService;
  getSafeProfile: (userId: string) => Promise<SafeProfile>;
}

export interface OperatorInvocation {
  scope: "PERSONAL" | "DIRECT_CHAT";
  directConversationId: string | null;
  participantNames: string[];
  contextMessages: Array<{ senderLabel: "self" | "peer"; text: string }>;
  resolveTaskOwner: (hint?: string) => TaskOwnerResolution;
}

export type TaskOwnerResolution =
  | {
      type: "ok";
      ownerUserId: string;
      assignedByUserId: string | null;
      assignmentSourceType: string | null;
      assignmentSourceId: string | null;
    }
  | { type: "clarify"; question: string }
  | { type: "deny"; message: string };

export interface OperatorToolContext {
  actor: ActorContext;
  source?: TrustedSourceContext;
  timezone: string | null;
  locale: "ru" | "en";
  defaultLocale: "ru" | "en";
  now: Date;
  services: OperatorToolServices;
  invocation: OperatorInvocation;
}

export interface ParsedCommand {
  tool: string;
  args: Record<string, unknown>;
}

export interface PlannerPlan {
  intent: "act" | "clarify" | "refuse" | "answer";
  userMessage: string;
  clarificationQuestion: string | null;
  commands: ParsedCommand[];
}

export interface ToolHandlerResult {
  card: OperatorActionCard;
  objectId: string | null;
}

export interface PreparedStep {
  sequence: number;
  toolName: string;
  args: Record<string, unknown>;
  confirmationRequired: boolean;
  card: OperatorActionCard;
  idempotencyKey: string;
}

export interface WorkspaceSnapshotItem {
  id: string;
  kind: "TASK" | "REMINDER" | "NOTE" | "LIST";
  title: string;
}

export interface WorkspaceSnapshot {
  timezone: string | null;
  locale: string;
  tasks: WorkspaceSnapshotItem[];
  reminders: WorkspaceSnapshotItem[];
  notes: WorkspaceSnapshotItem[];
  lists: WorkspaceSnapshotItem[];
}
