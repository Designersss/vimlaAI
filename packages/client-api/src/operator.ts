import {
  confirmOperatorRunSchema,
  continueOperatorRunSchema,
  createOperatorRunSchema,
  operatorConversationSchema,
  operatorRunViewSchema,
  type CreateOperatorRun,
  type OperatorConversation,
  type OperatorRunView,
} from "@vimla/contracts";
import {
  ClientApiError,
  jsonRequestInit,
  type ClientTransport,
} from "./transport.js";

export class OperatorRequestError extends ClientApiError {
  constructor(code: string, status = 0) {
    super(code, status);
    this.name = "OperatorRequestError";
  }
}

export interface OperatorRequestOptions {
  signal?: AbortSignal;
}

export function createOperatorClient(transport: ClientTransport) {
  const errorFactory = (code: string, status: number) =>
    new OperatorRequestError(code, status);

  return {
    fetchOperatorConversation(
      options: OperatorRequestOptions = {},
    ): Promise<OperatorConversation> {
      return transport.request("/v1/operator/conversation", {
        init: signalInit(options.signal),
        parse: (payload) => operatorConversationSchema.parse(payload),
        errorFactory,
      });
    },

    fetchOperatorRun(
      runId: string,
      options: OperatorRequestOptions = {},
    ): Promise<OperatorRunView> {
      return transport.request(
        `/v1/operator/runs/${encodeURIComponent(runId)}`,
        {
          init: signalInit(options.signal),
          parse: (payload) => operatorRunViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    createOperatorRun(
      input: CreateOperatorRun,
      options: OperatorRequestOptions = {},
    ): Promise<OperatorRunView> {
      const body = createOperatorRunSchema.parse(input);
      return transport.request("/v1/operator/runs", {
        init: jsonRequestInit("POST", body, options.signal),
        parse: (payload) => operatorRunViewSchema.parse(payload),
        errorFactory,
      });
    },

    confirmOperatorRun(
      runId: string,
      confirmationToken: string,
      options: OperatorRequestOptions = {},
    ): Promise<OperatorRunView> {
      const body = confirmOperatorRunSchema.parse({
        confirmationToken,
      });
      return transport.request(
        `/v1/operator/runs/${encodeURIComponent(runId)}/confirm`,
        {
          init: jsonRequestInit("POST", body, options.signal),
          parse: (payload) => operatorRunViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    continueOperatorRun(
      runId: string,
      input: { clientRequestId: string; content: string },
      options: OperatorRequestOptions = {},
    ): Promise<OperatorRunView> {
      const body = continueOperatorRunSchema.parse(input);
      return transport.request(
        `/v1/operator/runs/${encodeURIComponent(runId)}/continue`,
        {
          init: jsonRequestInit("POST", body, options.signal),
          parse: (payload) => operatorRunViewSchema.parse(payload),
          errorFactory,
        },
      );
    },

    cancelOperatorRun(
      runId: string,
      options: OperatorRequestOptions = {},
    ): Promise<OperatorRunView> {
      return transport.request(
        `/v1/operator/runs/${encodeURIComponent(runId)}/cancel`,
        {
          init: jsonRequestInit("POST", {}, options.signal),
          parse: (payload) => operatorRunViewSchema.parse(payload),
          errorFactory,
        },
      );
    },
  };
}

function signalInit(signal: AbortSignal | undefined): RequestInit {
  return signal ? { signal } : {};
}
