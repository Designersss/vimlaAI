import {
  clientInstallationViewSchema,
  registerClientInstallationSchema,
  updateClientInstallationPreferencesSchema,
  type ClientInstallationView,
  type RegisterClientInstallation,
  type UpdateClientInstallationPreferences,
} from "@vimla/contracts";
import {
  jsonRequestInit,
  type ClientTransport,
} from "./transport.js";

export function createInstallationsClient(
  transport: ClientTransport,
) {
  return {
    register(
      input: RegisterClientInstallation,
    ): Promise<ClientInstallationView> {
      const body = registerClientInstallationSchema.parse(input);
      return transport.request("/v1/client-installations/register", {
        init: jsonRequestInit("POST", body),
        parse: (payload) =>
          clientInstallationViewSchema.parse(payload),
      });
    },

    revoke(id: string): Promise<ClientInstallationView> {
      return transport.request(
        `/v1/client-installations/${encodeURIComponent(id)}/revoke`,
        {
          init: jsonRequestInit("POST", {}),
          parse: (payload) =>
            clientInstallationViewSchema.parse(payload),
        },
      );
    },

    updatePreferences(
      id: string,
      input: UpdateClientInstallationPreferences,
    ): Promise<ClientInstallationView> {
      const body =
        updateClientInstallationPreferencesSchema.parse(input);
      return transport.request(
        `/v1/client-installations/${encodeURIComponent(id)}/preferences`,
        {
          init: jsonRequestInit("PATCH", body),
          parse: (payload) =>
            clientInstallationViewSchema.parse(payload),
        },
      );
    },
  };
}
