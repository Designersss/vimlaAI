import { parsePublicAdminConfig } from "@vimla/config/public";

export const publicAdminConfig = parsePublicAdminConfig({
  NEXT_PUBLIC_ADMIN_API_BASE_URL: process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL,
});
