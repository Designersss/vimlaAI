import type {
  CreateOperatorRun,
  OperatorConversation,
  OperatorRunView,
} from "@vimla/contracts";
import {
  OperatorRequestError,
  type OperatorRequestOptions as SharedOperatorRequestOptions,
} from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

export { OperatorRequestError };

export interface OperatorRequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function sharedOptions(
  options: OperatorRequestOptions,
): SharedOperatorRequestOptions {
  return options.signal ? { signal: options.signal } : {};
}

export async function fetchOperatorConversation(
  fetchImpl: typeof fetch = fetch,
): Promise<OperatorConversation> {
  return createWebClientApi(fetchImpl).operator.fetchOperatorConversation();
}

export async function fetchOperatorRun(
  runId: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  return createWebClientApi(options.fetchImpl ?? fetch).operator.fetchOperatorRun(
    runId,
    sharedOptions(options),
  );
}

export async function createOperatorRun(
  input: CreateOperatorRun,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  return createWebClientApi(options.fetchImpl ?? fetch).operator.createOperatorRun(
    input,
    sharedOptions(options),
  );
}

export async function confirmOperatorRun(
  runId: string,
  confirmationToken: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  return createWebClientApi(options.fetchImpl ?? fetch).operator.confirmOperatorRun(
    runId,
    confirmationToken,
    sharedOptions(options),
  );
}

export async function continueOperatorRun(
  runId: string,
  input: { clientRequestId: string; content: string },
): Promise<OperatorRunView> {
  return createWebClientApi().operator.continueOperatorRun(runId, input);
}

export async function cancelOperatorRun(
  runId: string,
  options: OperatorRequestOptions = {},
): Promise<OperatorRunView> {
  return createWebClientApi(options.fetchImpl ?? fetch).operator.cancelOperatorRun(
    runId,
    sharedOptions(options),
  );
}
