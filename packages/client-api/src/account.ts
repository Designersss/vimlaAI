import {
  claimHandleSchema,
  currentUserSchema,
  handleAvailabilityResponseSchema,
  handleInputSchema,
  type CurrentUser,
  type HandleAvailabilityResponse,
} from "@vimla/contracts";
import {
  ClientApiError,
  jsonRequestInit,
  queryString,
  type ClientTransport,
} from "./transport.js";

export class HandleUnavailableError extends ClientApiError {
  constructor(status = 409) {
    super("handle_unavailable", status);
    this.name = "HandleUnavailableError";
  }
}

export function createAccountClient(transport: ClientTransport) {
  return {
    fetchCurrentUser(): Promise<CurrentUser> {
      return transport.request("/v1/me", {
        parse: (payload) => currentUserSchema.parse(payload),
      });
    },

    updatePreferences(
      input: { locale?: CurrentUser["locale"]; timezone?: string },
    ): Promise<CurrentUser> {
      return transport.request("/v1/me/preferences", {
        init: jsonRequestInit("PATCH", input),
        parse: (payload) => currentUserSchema.parse(payload),
      });
    },

    checkHandleAvailability(
      input: string,
    ): Promise<HandleAvailabilityResponse> {
      const handle = handleInputSchema.parse(input);
      return transport.request(
        `/v1/handles/availability${queryString([["handle", handle]])}`,
        {
          parse: (payload) =>
            handleAvailabilityResponseSchema.parse(payload),
        },
      );
    },

    async claimHandle(input: string): Promise<void> {
      const body = claimHandleSchema.parse({ handle: input });
      return transport.request("/v1/handles/claim", {
        init: jsonRequestInit("POST", body),
        parse: () => undefined,
        errorFactory: (code, status) =>
          status === 409
            ? new HandleUnavailableError(status)
            : new ClientApiError(code, status),
      });
    },
  };
}
