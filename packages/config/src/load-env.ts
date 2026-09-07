import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

let loaded = false;

export function loadEnvFiles(): void {
  if (loaded) {
    return;
  }

  loaded = true;

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath, override: false });
    }
  }
}
