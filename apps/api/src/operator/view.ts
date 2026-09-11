import {
  operatorRunViewSchema,
  type OperatorActionCard,
  type OperatorRunView,
} from "@vimla/contracts";

export interface OperatorRunViewSource {
  id: string;
  status: string;
  publicMessage: string | null;
  clarificationQuestion: string | null;
  errorCode: string | null;
  conversationId: string;
  invocationScope?: string | null;
  directConversationId?: string | null;
  contextOwnIncluded?: boolean;
  contextPeerIncluded?: boolean;
  contextPeerDenied?: boolean;
  createdAt: Date;
  updatedAt: Date;
  steps: Array<{
    toolName: string;
    status: string;
    publicKind: string;
    publicTitle: string;
    publicDetail: string | null;
    publicHrefPath: string | null;
  }>;
}

export function buildOperatorRunView(run: OperatorRunViewSource, confirmationToken: string | null): OperatorRunView {
  const actions: OperatorActionCard[] = run.steps.map((step) => ({
    kind: step.publicKind as OperatorActionCard["kind"],
    operation: operationFromTool(step.toolName),
    title: step.publicTitle,
    detail: step.publicDetail,
    status:
      step.status === "EXECUTED"
        ? "success"
        : step.status === "FAILED"
          ? "error"
          : step.status === "NEEDS_CONFIRMATION"
            ? "pending_confirmation"
            : "skipped",
    hrefPath: step.publicHrefPath,
  }));

  return operatorRunViewSchema.parse({
    id: run.id,
    status: run.status,
    publicMessage: run.publicMessage,
    clarificationQuestion: run.clarificationQuestion,
    confirmationRequired: run.status === "AWAITING_CONFIRMATION",
    confirmationToken: run.status === "AWAITING_CONFIRMATION" ? confirmationToken : null,
    errorCode: run.errorCode,
    actions,
    conversationId: run.conversationId,
    invocationScope: run.invocationScope === "DIRECT_CHAT" ? "DIRECT_CHAT" : "PERSONAL",
    directConversationId: run.directConversationId ?? null,
    contextOwnIncluded: run.contextOwnIncluded ?? false,
    contextPeerIncluded: run.contextPeerIncluded ?? false,
    contextPeerDenied: run.contextPeerDenied ?? false,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  });
}

function operationFromTool(toolName: string): OperatorActionCard["operation"] {
  if (toolName.endsWith(".create")) {
    return "created";
  }
  if (toolName.endsWith(".delete")) {
    return "deleted";
  }
  if (toolName.endsWith(".pin")) {
    return "pinned";
  }
  if (toolName.endsWith(".addItem")) {
    return "item_added";
  }
  if (toolName.endsWith(".list")) {
    return "listed";
  }
  if (toolName.endsWith(".get") || toolName.endsWith(".getSafe") || toolName.endsWith(".getPreferences")) {
    return "read";
  }
  return "updated";
}
