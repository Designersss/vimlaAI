import type {
  PeopleSearchResponse,
  PublicProfile,
} from "@vimla/contracts/public-profiles";
import { createWebClientApi } from "../../../shared/api/client";

export function searchPeople(
  q: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PeopleSearchResponse> {
  return createWebClientApi(fetchImpl).people.searchPeople({
    q,
    limit: 8,
  });
}

export function fetchPublicProfile(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicProfile> {
  return createWebClientApi(fetchImpl).people.fetchProfile(handle);
}
