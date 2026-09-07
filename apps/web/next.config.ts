import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

loadDotenv({
  path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))),
  override: false,
});

const nextConfig: NextConfig = {
  transpilePackages: ["@vimla/config", "@vimla/contracts", "better-auth"],
  sassOptions: {
    implementation: "sass",
  },
};

export default nextConfig;
