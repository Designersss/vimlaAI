import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { Client } from "pg";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const envPath = resolve(repoRoot, ".env");
const databaseNamePattern = /^[a-z][a-z0-9_]*$/;

if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: false });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!databaseNamePattern.test(name)) {
    throw new Error(`Unsafe test database name: ${name}`);
  }
  return name;
}

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${String(code)}`));
    });
  });
}

async function main(): Promise<void> {
  const adminUrl = requiredEnv("DATABASE_URL");
  const testUrl = requiredEnv("TEST_DATABASE_URL");
  const testDatabase = databaseNameFromUrl(testUrl);

  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Cannot reach PostgreSQL at DATABASE_URL (${message}). Start local infrastructure with \`docker compose up -d\`, then re-run \`pnpm test:integration\`.`,
      { cause: error },
    );
  }

  try {
    const existing = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname = $1",
      [testDatabase],
    );

    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${testDatabase}`);
    }
  } finally {
    await client.end();
  }

  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    DATABASE_URL: testUrl,
  });
}

await main();
