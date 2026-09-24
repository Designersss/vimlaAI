import type { ChatMessageRoute, MessageMentionInput } from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export async function streamAssistantMessage(input: {
  conversationId: string;
  clientRequestId: string;
  modelId?: string;
  content: string;
  mentions?: MessageMentionInput[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onRoute?: (route: ChatMessageRoute) => void;
  onWorkflow?: (workflow: { status: string; planId?: string }) => void;
  onError: (code: string) => void;
}): Promise<void> {
  const response = await fetch(
    `${publicWebConfig.apiBaseUrl}/v1/conversations/${input.conversationId}/messages`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: input.clientRequestId,
        ...(input.modelId ? { modelId: input.modelId } : {}),
        content: input.content,
        mentions: input.mentions ?? [],
      }),
    },
  );

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error !== null &&
      typeof payload.error === "object" &&
      "code" in payload.error &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : "internal_error";
    input.onError(code);
    return;
  }

  if (!response.body) {
    input.onError("internal_error");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  const streamInput = {
    onDelta: input.onDelta,
    onDone: () => {
      terminal = true;
      input.onDone();
    },
    onRoute: input.onRoute,
    onWorkflow: input.onWorkflow,
    onError: (code: string) => {
      terminal = true;
      input.onError(code);
    },
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSse(buffer, streamInput);
  }

  consumeSse(buffer + decoder.decode(), streamInput, true);
  if (!terminal) {
    input.onError("internal_error");
  }
}

function consumeSse(
  buffer: string,
  input: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onRoute?: (route: ChatMessageRoute) => void;
    onWorkflow?: (workflow: { status: string; planId?: string }) => void;
    onError: (code: string) => void;
  },
  flush = false,
): string {
  const normalized = buffer.replaceAll("\r\n", "\n");
  let remaining = normalized;

  while (true) {
    const boundary = remaining.indexOf("\n\n");
    if (boundary === -1) {
      return flush ? "" : remaining;
    }

    const block = remaining.slice(0, boundary);
    remaining = remaining.slice(boundary + 2);
    applySseBlock(block, input);
  }
}

function applySseBlock(
  block: string,
  input: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onRoute?: (route: ChatMessageRoute) => void;
    onWorkflow?: (workflow: { status: string; planId?: string }) => void;
    onError: (code: string) => void;
  },
): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  try {
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    if (event === "delta" && typeof payload.text === "string") {
      input.onDelta(payload.text);
    }
    if (
      event === "route" &&
      input.onRoute &&
      (payload.route === "CHAT" || payload.route === "ORCHESTRATION")
    ) {
      input.onRoute(payload.route);
    }
    if (event === "workflow" && input.onWorkflow && typeof payload.status === "string") {
      input.onWorkflow({
        status: payload.status,
        ...(typeof payload.planId === "string" ? { planId: payload.planId } : {}),
      });
    }
    if (event === "done") {
      input.onDone();
    }
    if (event === "error" && typeof payload.code === "string") {
      input.onError(payload.code);
    }
  } catch {
    input.onError("internal_error");
  }
}
