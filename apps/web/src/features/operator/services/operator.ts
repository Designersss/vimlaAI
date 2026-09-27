import {
  confirmOperatorRunSchema,
  continueOperatorRunSchema,
  createOperatorRunSchema,
  operatorConversationSchema,
  operatorRunViewSchema,
  type OperatorConversation,
  type OperatorRunView,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

function headers(): HeadersInit {
  return { "content-type": "application/json" };
}

export interface OperatorRequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function requestFetch(
  options: OperatorRequestOptions,
): typeof fetch {
  return options.fetchImpl ?? fetch;
}

async function parseRun(response: Response): Promise<OperatorRunView> {
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
    throw new OperatorRequestError(code);
  }
  return operatorRunViewSchema.parse(await response.json());
}

export class OperatorRequestError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "OperatorRequestError";
    this.code = code;
  }
}

export async function fetchOperatorConversation(
  fetchImpl: typeof fetch = fetch,
): Promise<OperatorConversation> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}/v1/operator/conversation`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error("Unable to load the operator conversation");
  }
  return operatorConversationSchema.parse(await response.json());
}

export async function fetchOperatorRun(
  runId: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  const response = await requestFetch(options)(
    `${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}`,
    {
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
    },
  );
  return parseRun(response);
}

export async function createOperatorRun(input: {
  clientRequestId: string;
  content: string;
  conversationId?: string;
  invocationScope?: "PERSONAL" | "DIRECT_CHAT";
  directConversationId?: string;
  directSourceMessageId?: string;
  contextBundle?: {
    messages: Array<{
      messageId: string;
      senderUserId: string;
      sentAt: string;
      text: string;
    }>;
  };
},
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  const body = createOperatorRunSchema.parse(input);
  const response = await requestFetch(options)(
    `${publicWebConfig.apiBaseUrl}/v1/operator/runs`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
  return parseRun(response);
}

export async function confirmOperatorRun(
  runId: string,
  confirmationToken: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  const body = confirmOperatorRunSchema.parse({
    confirmationToken,
  });
  const response = await requestFetch(options)(
    `${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}/confirm`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
  return parseRun(response);
}

export async function continueOperatorRun(
  runId: string,
  input: { clientRequestId: string; content: string },
): Promise<OperatorRunView> {
  const body = continueOperatorRunSchema.parse(input);
  const response = await fetch(`${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}/continue`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return parseRun(response);
}

export async function cancelOperatorRun(
  runId: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  const response = await requestFetch(options)(
    `${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify({}),
      signal: options.signal,
    },
  );
  return parseRun(response);
}
