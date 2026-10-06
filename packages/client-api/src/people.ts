import {
  peopleSearchQuerySchema,
  peopleSearchResponseSchema,
  publicProfileSchema,
  updatePublicProfileSchema,
  type PeopleSearchResponse,
  type PublicProfile,
  type UpdatePublicProfile,
} from "@vimla/contracts/public-profiles";
import {
  jsonRequestInit,
  queryString,
  type ClientTransport,
} from "./transport.js";

export interface PeopleSearchRequest {
  q: string;
  limit?: number;
}

export function createPeopleClient(
  transport: ClientTransport,
) {
  return {
    searchPeople(
      input: PeopleSearchRequest,
    ): Promise<PeopleSearchResponse> {
      const query = peopleSearchQuerySchema.parse(input);
      return transport.request(
        `/v1/people${queryString([
          ["q", query.q],
          ["limit", query.limit],
        ])}`,
        {
          parse: (payload) =>
            peopleSearchResponseSchema.parse(payload),
        },
      );
    },

    fetchProfile(
      handle: string,
    ): Promise<PublicProfile> {
      return transport.request(
        `/v1/people/${encodeURIComponent(handle)}`,
        {
          parse: (payload) =>
            publicProfileSchema.parse(payload),
        },
      );
    },

    updateMyProfile(
      input: UpdatePublicProfile,
    ): Promise<PublicProfile> {
      const body = updatePublicProfileSchema.parse(input);
      return transport.request("/v1/people/me", {
        init: jsonRequestInit("PATCH", body),
        parse: (payload) =>
          publicProfileSchema.parse(payload),
      });
    },
  };
}
