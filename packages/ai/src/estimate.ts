import { AiError } from "./errors.js";
import type {
  ProviderChatMessage,
  ProviderToolDefinition,
} from "./types.js";

const MESSAGE_OVERHEAD_BYTES = 24;
const SAFETY_BYTES = 32;
// Chat-completions providers add framing/template metadata that is not visible
// in user/tool content. Budget it explicitly so the financial admission bound
// covers more than just message.content bytes.
const PROVIDER_REQUEST_FIXED_OVERHEAD_TOKENS = 4_096;
const PROVIDER_REQUEST_ITEM_OVERHEAD_TOKENS = 1_024;

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Conservative model-agnostic estimator. 1 UTF-8 byte counts as 1 token so
 * Latin text is overestimated; this is a financial hold, not a tokenizer.
 * Actual provider usage is the settlement source of truth.
 */
export function estimateInputTokens(
  messages: ReadonlyArray<{ content: string }>,
): number {
  let bytes = SAFETY_BYTES;
  for (const message of messages) {
    bytes += utf8ByteLength(message.content) + MESSAGE_OVERHEAD_BYTES;
  }

  return bytes < 1 ? 1 : bytes;
}

/**
 * Conservative provider-turn input bound.
 *
 * Unlike estimateInputTokens(), this includes all message metadata required for
 * tool calls/results plus the tool definitions themselves. The extra fixed and
 * per-item token envelopes cover provider chat-template/framing overhead that
 * is not present in the JSON payload. This function is intentionally
 * conservative because it protects a financial hard cap.
 */
export function estimateProviderRequestInputTokens(
  messages: readonly ProviderChatMessage[],
  tools: readonly ProviderToolDefinition[] = [],
): number {
  const wireShape = {
    messages: messages.map(serializeBudgetMessage),
    ...(tools.length > 0
      ? {
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
  };
  const serializedBytes = utf8ByteLength(JSON.stringify(wireShape));
  const itemCount = messages.length + tools.length;
  return Math.max(
    1,
    serializedBytes +
      PROVIDER_REQUEST_FIXED_OVERHEAD_TOKENS +
      itemCount * PROVIDER_REQUEST_ITEM_OVERHEAD_TOKENS,
  );
}

function serializeBudgetMessage(
  message: ProviderChatMessage,
): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      name: message.toolName ?? "",
      content: message.content,
    };
  }

  if (
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0
  ) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

export function assertMessageSize(content: string, maxBytes: number): void {
  if (utf8ByteLength(content) > maxBytes) {
    throw new AiError("MESSAGE_TOO_LARGE", "Message exceeds the configured size limit", 400);
  }
}

export function selectContextMessages<T extends { content: string }>(
  messages: readonly T[],
  maxContextBytes: number,
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const size = utf8ByteLength(message.content) + MESSAGE_OVERHEAD_BYTES;
    if (selected.length > 0 && used + size > maxContextBytes) {
      break;
    }

    selected.push(message);
    used += size;
  }

  return selected.reverse();
}
