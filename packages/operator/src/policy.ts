import { OPERATOR_RUNTIME_LIMITS } from "./limits.js";
import { OperatorError } from "./errors.js";
import {
  DENIED_TOOL_NAMES,
  operatorToolInputSchemas,
  operatorToolNames,
  type OperatorToolName,
} from "./tools/schemas.js";
import type { ParsedCommand } from "./types.js";

const DESTRUCTIVE_TOOLS = new Set<OperatorToolName>([
  "tasks.delete",
  "reminders.delete",
  "notes.delete",
  "lists.delete",
]);

const SENSITIVE_WRITE_TOOLS = new Set<OperatorToolName>([
  "notifications.updatePreferences",
]);

const DIRECT_CHAT_ALLOWED_TOOLS = new Set<OperatorToolName>([
  "tasks.create",
]);

export function isRegisteredTool(name: string): name is OperatorToolName {
  return (operatorToolNames as readonly string[]).includes(name);
}

export function toolRequiresConfirmation(name: OperatorToolName, args: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_TOOLS.has(name) || SENSITIVE_WRITE_TOOLS.has(name)) {
    return true;
  }
  if (name === "reminders.update" && args.status === "CANCELED") {
    return true;
  }
  if (name === "tasks.update" && args.status === "CANCELED") {
    return true;
  }
  return false;
}

export function evaluatePlanPolicy(
  commands: readonly ParsedCommand[],
  maxTools = OPERATOR_RUNTIME_LIMITS.maxToolsPerRun,
  invocationScope: "PERSONAL" | "DIRECT_CHAT" = "PERSONAL",
): { confirmationRequired: boolean } {
  if (commands.length > maxTools) {
    throw new OperatorError("PLAN_INVALID", "Plan exceeds the tool execution bound");
  }

  for (const command of commands) {
    if ((DENIED_TOOL_NAMES as readonly string[]).includes(command.tool)) {
      throw new OperatorError("TOOL_DENIED", "Tool is not allowed");
    }
    if (!isRegisteredTool(command.tool)) {
      throw new OperatorError("TOOL_DENIED", "Unknown operator tool");
    }
    if (
      invocationScope === "DIRECT_CHAT" &&
      !DIRECT_CHAT_ALLOWED_TOOLS.has(command.tool)
    ) {
      throw new OperatorError(
        "TOOL_DENIED",
        "This tool is not available from a Direct Chat",
      );
    }
    const schema = operatorToolInputSchemas[command.tool];
    const parsed = schema.safeParse(command.args);
    if (!parsed.success) {
      throw new OperatorError("PLAN_INVALID", "Tool arguments failed validation");
    }
  }

  const confirmationRequired = commands.some((command) => {
    if (!isRegisteredTool(command.tool)) {
      return false;
    }
    return toolRequiresConfirmation(command.tool, command.args);
  });

  return { confirmationRequired };
}

export function parseToolArgs(tool: OperatorToolName, args: unknown): Record<string, unknown> {
  const parsed = operatorToolInputSchemas[tool].safeParse(args);
  if (!parsed.success) {
    throw new OperatorError("PLAN_INVALID", "Tool arguments failed validation");
  }
  return parsed.data as Record<string, unknown>;
}
