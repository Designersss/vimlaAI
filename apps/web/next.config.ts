import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

loadDotenv({
  path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))),
  override: false,
});

const nextConfig: NextConfig = {
  transpilePackages: ["@vimla/config", "@vimla/contracts", "@vimla/shared", "@vimla/ui", "better-auth"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  sassOptions: {
    implementation: "sass",
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
