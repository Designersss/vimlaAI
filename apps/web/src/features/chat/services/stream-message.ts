import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export async function streamAssistantMessage(input: {
  conversationId: string;
  clientRequestId: string;
  modelId: string;
  content: string;
  onDelta: (text: string) => void;
  onDone: () => void;
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
        modelId: input.modelId,
        content: input.content,
      }),
    },
  );

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.body) {
    input.onError("internal_error");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSse(buffer, input);
  }

  consumeSse(buffer + decoder.decode(), input, true);
}

function consumeSse(
  buffer: string,
  input: {
    onDelta: (text: string) => void;
    onDone: () => void;
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
