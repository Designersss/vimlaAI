import { parsePublicWebConfig } from "@vimla/config/public";

// Next.js inlines only static `process.env.NEXT_PUBLIC_*` property access in app source.
export const publicWebConfig = parsePublicWebConfig({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
