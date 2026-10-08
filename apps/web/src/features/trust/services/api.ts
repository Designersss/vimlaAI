import type {
  AbuseReportReceipt,
  BlockedUsersResponse,
  CreateAbuseReport,
  SurfacePreference,
  UpdateSurfacePreference,
  UserBlockState,
} from "@vimla/contracts";
import {
  AuthRequiredError,
  TrustApiError,
} from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

export { AuthRequiredError, TrustApiError };

export function listBlockedUsers(
  query: { cursor?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<BlockedUsersResponse> {
  return createWebClientApi(fetchImpl).trust.listBlockedUsers(query);
}

export function blockUser(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserBlockState> {
  return createWebClientApi(fetchImpl).trust.blockUser(handle);
}

export function unblockUser(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserBlockState> {
  return createWebClientApi(fetchImpl).trust.unblockUser(handle);
}

export function reportUser(
  input: CreateAbuseReport,
  fetchImpl: typeof fetch = fetch,
): Promise<AbuseReportReceipt> {
  return createWebClientApi(fetchImpl).trust.reportUser(input);
}

export function fetchSurfacePreference(
  surfaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SurfacePreference> {
  return createWebClientApi(fetchImpl).trust.fetchSurfacePreference(surfaceId);
}

export function updateSurfacePreference(
  surfaceId: string,
  input: UpdateSurfacePreference,
  fetchImpl: typeof fetch = fetch,
): Promise<SurfacePreference> {
  return createWebClientApi(fetchImpl).trust.updateSurfacePreference(surfaceId, input);
}
