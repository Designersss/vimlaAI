import type { ProviderToolCall, ProviderToolDefinition } from "@vimla/ai";

export interface ExternalAiToolContext {
  userId: string;
  conversationId: string;
  planId: string;
  invocationId: string;
}

export interface ExternalAiToolBroker {
  listTools(context: ExternalAiToolContext): Promise<readonly ProviderToolDefinition[]>;
  execute(input: ExternalAiToolContext & {
    call: ProviderToolCall;
    idempotencyKey: string;
    abortSignal?: AbortSignal;
  }): Promise<unknown>;
}

export class NoopExternalAiToolBroker implements ExternalAiToolBroker {
  async listTools(_context: ExternalAiToolContext): Promise<readonly ProviderToolDefinition[]> {
    return [];
  }

  async execute(
    input: ExternalAiToolContext & { call: ProviderToolCall; idempotencyKey: string },
  ): Promise<unknown> {
    throw new Error(`External AI tool is not authorized: ${input.call.name}`);
  }
}
