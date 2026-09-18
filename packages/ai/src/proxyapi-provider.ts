import { OpenAiCompatSseParser } from "./sse.js";
import { joinUrl } from "./http-transport.js";
import { ProviderCallError, type AiProvider, type HttpFetch, type ProviderChatRequest, type ProviderChatResult, type ProviderStreamEvent } from "./types.js";

const NEVER_REACHED_PROVIDER = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

export class ProxyApiProvider implements AiProvider {
  readonly id = "proxyapi";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: HttpFetch,
  ) {
    if (this.apiKey.trim().length === 0) {
      throw new Error("ProxyAPI key is required for ProxyApiProvider");
    }
  }

  async streamChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.abortSignal
      ? AbortSignal.any([request.abortSignal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Request-ID": request.correlationId,
        },
        body: JSON.stringify({
          model: request.providerModelId,
          messages: request.messages.map(serializeProviderMessage),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
              }
            : {}),
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: request.maxOutputTokens,
        }),
        signal,
      });
    } catch (error: unknown) {
      throw classifyNetworkError(error);
    }

    if (!response.ok) {
      throw classifyHttpError(response.status);
    }

    const providerRequestId =
      response.headers.get("x-request-id") ?? response.headers.get("X-Request-ID");
    const body = response.body;
    if (!body) {
      throw new ProviderCallError("ambiguous", "Provider response had no body", response.status);
    }

    return {
      providerRequestId,
      events: readProxyApiStream(body),
    };
  }
}

function serializeProviderMessage(message: ProviderChatRequest["messages"][number]): Record<string, unknown> {
  if (message.role === "tool") {
    if (!message.toolCallId) {
      throw new ProviderCallError("rejected", "Tool result message is missing toolCallId", null);
    }
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
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

async function* readProxyApiStream(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
  const parser = new OpenAiCompatSseParser();
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield* parser.finish();
        return;
      }

      if (value) {
        yield* parser.push(value);
      }
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new ProviderCallError("ambiguous", error.message, null);
    }
    throw classifyNetworkError(error);
  }
}

function classifyHttpError(status: number): ProviderCallError {
  if (status === 402) {
    return new ProviderCallError("balance", "Provider corporate balance is unavailable", status);
  }

  if (status === 408 || status >= 500) {
    return new ProviderCallError("ambiguous", "Provider returned an ambiguous failure", status);
  }

  return new ProviderCallError("rejected", "Provider rejected the request before execution", status);
}

function classifyNetworkError(error: unknown): ProviderCallError {
  if (error instanceof ProviderCallError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Provider network failure";
  if (error instanceof Error && error.name === "TimeoutError") {
    return new ProviderCallError("ambiguous", "Provider request timed out", 408);
  }

  if (NEVER_REACHED_PROVIDER.test(message)) {
    return new ProviderCallError("rejected", "Provider connection was refused", null);
  }

  return new ProviderCallError("ambiguous", "Provider request outcome is uncertain", null);
}
