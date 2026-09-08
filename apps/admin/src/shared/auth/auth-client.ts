import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { publicAdminConfig } from "../config/public-env";

export const adminAuthClient = createAuthClient({
  baseURL: publicAdminConfig.apiBaseUrl,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    twoFactorClient({
      twoFactorPage: "/elevate",
    }),
    passkeyClient(),
  ],
});
