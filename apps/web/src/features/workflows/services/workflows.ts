import {
  executionPlanConversationViewSchema,
  executionPlanViewSchema,
  type ExecutionPlanConversationView,
  type ExecutionPlanView,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

function headers(): HeadersInit {
  return { "content-type": "application/json" };
}

export class WorkflowRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WorkflowRequestError";
    this.code = code;
  }
}

async function parsePlan(response: Response): Promise<ExecutionPlanView> {
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new WorkflowRequestError(await responseErrorCode(response));
  }
  return executionPlanViewSchema.parse(await response.json());
}

async function responseErrorCode(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (
    payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error !== null &&
    typeof payload.error === "object" &&
    "code" in payload.error &&
    typeof payload.error.code === "string"
  ) {
    return payload.error.code;
  }
  return "internal_error";
}

export async function fetchConversationWorkflows(
  conversationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionPlanConversationView> {
  const response = await fetchImpl(
    `${publicWebConfig.apiBaseUrl}/v1/execution-plans/by-conversation/${encodeURIComponent(conversationId)}`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new WorkflowRequestError(await responseErrorCode(response));
  }
  return executionPlanConversationViewSchema.parse(await response.json());
}

export async function fetchExecutionPlan(
  planId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionPlanView> {
  const response = await fetchImpl(
    `${publicWebConfig.apiBaseUrl}/v1/execution-plans/${encodeURIComponent(planId)}`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  return parsePlan(response);
}

export async function startExecutionPlan(planId: string): Promise<ExecutionPlanView> {
  const response = await fetch(
    `${publicWebConfig.apiBaseUrl}/v1/execution-plans/${encodeURIComponent(planId)}/start`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify({}),
    },
  );
  return parsePlan(response);
}

export async function stopExecutionPlan(planId: string): Promise<ExecutionPlanView> {
  const response = await fetch(
    `${publicWebConfig.apiBaseUrl}/v1/execution-plans/${encodeURIComponent(planId)}/stop`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify({}),
    },
  );
  return parsePlan(response);
}

export async function approveExecutionPlanInvocation(
  planId: string,
  invocationId: string,
): Promise<ExecutionPlanView> {
  const response = await fetch(
    `${publicWebConfig.apiBaseUrl}/v1/execution-plans/${encodeURIComponent(planId)}/approve`,
    {
      method: "POST",
      credentials: "include",
      headers: headers(),
      body: JSON.stringify({ invocationId }),
    },
  );
  return parsePlan(response);
}
