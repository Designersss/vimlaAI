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

export async function fetchOperatorRun(runId: string): Promise<OperatorRunView> {
  const response = await fetch(`${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}`, {
    credentials: "include",
    cache: "no-store",
  });
  return parseRun(response);
}

export async function createOperatorRun(input: {
  clientRequestId: string;
  content: string;
  conversationId?: string;
  invocationScope?: "PERSONAL" | "DIRECT_CHAT";
  directConversationId?: string;
  contextBundle?: { messages: Array<{ senderUserId: string; sentAt: string; text: string }> };
}): Promise<OperatorRunView> {
  const body = createOperatorRunSchema.parse(input);
  const response = await fetch(`${publicWebConfig.apiBaseUrl}/v1/operator/runs`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return parseRun(response);
}

export async function confirmOperatorRun(runId: string, confirmationToken: string): Promise<OperatorRunView> {
  const body = confirmOperatorRunSchema.parse({ confirmationToken });
  const response = await fetch(`${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}/confirm`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify(body),
  });
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

export async function cancelOperatorRun(runId: string): Promise<OperatorRunView> {
  const response = await fetch(`${publicWebConfig.apiBaseUrl}/v1/operator/runs/${runId}/cancel`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify({}),
  });
  return parseRun(response);
}
