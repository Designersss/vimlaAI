import {
  abuseReportReceiptSchema,
  blockedUsersQuerySchema,
  blockedUsersResponseSchema,
  blockUserSchema,
  createAbuseReportSchema,
  surfacePreferenceSchema,
  updateSurfacePreferenceSchema,
  userBlockStateSchema,
  type AbuseReportReceipt,
  type BlockedUsersQuery,
  type BlockedUsersResponse,
  type CreateAbuseReport,
  type SurfacePreference,
  type UpdateSurfacePreference,
  type UserBlockState,
} from "@vimla/contracts";
import {
  ClientApiError,
  jsonRequestInit,
  type ClientTransport,
} from "./transport.js";

export class TrustApiError extends ClientApiError {
  constructor(code: string, status = 0) {
    super(code, status);
    this.name = "TrustApiError";
  }
}

export function createTrustClient(
  transport: ClientTransport,
) {
  const errorFactory = (code: string, status: number) =>
    new TrustApiError(code, status);

  return {
    listBlockedUsers(
      query: Partial<BlockedUsersQuery> = {},
    ): Promise<BlockedUsersResponse> {
      const parsed = blockedUsersQuerySchema.parse(query);
      const params = new URLSearchParams({
        limit: String(parsed.limit),
      });
      if (parsed.cursor) {
        params.set("cursor", parsed.cursor);
      }
      return transport.request(
        `/v1/trust/blocks?${params.toString()}`,
        {
          parse: (payload) =>
            blockedUsersResponseSchema.parse(payload),
          errorFactory,
        },
      );
    },

    blockUser(handle: string): Promise<UserBlockState> {
      const body = blockUserSchema.parse({ handle });
      return transport.request("/v1/trust/blocks", {
        init: jsonRequestInit("POST", body),
        parse: (payload) =>
          userBlockStateSchema.parse(payload),
        errorFactory,
      });
    },

    unblockUser(handle: string): Promise<UserBlockState> {
      const body = blockUserSchema.parse({ handle });
      return transport.request(
        `/v1/trust/blocks/${encodeURIComponent(body.handle)}`,
        {
          init: { method: "DELETE" },
          parse: (payload) =>
            userBlockStateSchema.parse(payload),
          errorFactory,
        },
      );
    },

    reportUser(
      input: CreateAbuseReport,
    ): Promise<AbuseReportReceipt> {
      const body = createAbuseReportSchema.parse(input);
      return transport.request("/v1/trust/reports", {
        init: jsonRequestInit("POST", body),
        parse: (payload) =>
          abuseReportReceiptSchema.parse(payload),
        errorFactory,
      });
    },

    fetchSurfacePreference(
      surfaceId: string,
    ): Promise<SurfacePreference> {
      return transport.request(
        `/v1/trust/surfaces/${encodeURIComponent(surfaceId)}/preference`,
        {
          parse: (payload) =>
            surfacePreferenceSchema.parse(payload),
          errorFactory,
        },
      );
    },

    updateSurfacePreference(
      surfaceId: string,
      input: UpdateSurfacePreference,
    ): Promise<SurfacePreference> {
      const body = updateSurfacePreferenceSchema.parse(input);
      return transport.request(
        `/v1/trust/surfaces/${encodeURIComponent(surfaceId)}/preference`,
        {
          init: jsonRequestInit("PATCH", body),
          parse: (payload) =>
            surfacePreferenceSchema.parse(payload),
          errorFactory,
        },
      );
    },
  };
}
