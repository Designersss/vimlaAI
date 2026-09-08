import { loadApiConfig } from "@vimla/config/server";
import { createPrismaClient } from "@vimla/database";
import { AdminControlService } from "./control.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const userId = argValue("--user-id");
  if (!command || !userId) {
    console.error("Usage: pnpm admin:<command> --user-id <uuid>");
    process.exit(1);
  }

  const config = loadApiConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const admin = new AdminControlService(prisma, {
    secret: config.betterAuthSecret,
    ttlSeconds: config.adminSessionTtlSeconds,
    idleSeconds: config.adminSessionIdleSeconds,
    stepUpSeconds: config.adminStepUpSeconds,
    requireTotp: config.adminRequireTotp,
    requirePasskey: config.adminRequirePasskey,
    cookieSecure: config.nodeEnv === "production" || config.appEnv === "production",
  });

  try {
    if (command === "bootstrap") {
      const result = await admin.bootstrapOwner(userId);
      console.log(
        result.created
          ? `Created OWNER AdminPrincipal ${result.principalId}`
          : `OWNER AdminPrincipal already existed ${result.principalId}`,
      );
    } else if (command === "disable") {
      await admin.disablePrincipal(userId);
      console.log(`Disabled AdminPrincipal for ${userId}`);
    } else if (command === "revoke-sessions") {
      const count = await admin.revokeSessions(userId);
      console.log(`Revoked ${count} AdminSession(s) for ${userId}`);
    } else {
      console.error("Unknown command. Use bootstrap | disable | revoke-sessions");
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
