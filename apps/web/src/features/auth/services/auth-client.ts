import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { publicWebConfig } from "../../../shared/config/public-env";

export const authClient = createAuthClient({
  baseURL: publicWebConfig.apiBaseUrl,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [emailOTPClient()],
});
