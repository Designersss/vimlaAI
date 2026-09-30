import {
  clientInstallationIdSchema,
  type ClientInstallationView,
} from "@vimla/contracts";
import { ClientApiError } from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";

const INSTALLATION_STORAGE_PREFIX = "vimla:client-installation:v1:";
const WEB_PROTOCOL_VERSION = 1;

export interface WebInstallationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EnsureWebInstallationOptions {
  storage?: WebInstallationStorage;
  randomUuid?: () => string;
  fetchImpl?: typeof fetch;
}

export async function ensureWebInstallation(
  userId: string,
  options: EnsureWebInstallationOptions = {},
): Promise<ClientInstallationView> {
  const storage = options.storage ?? window.localStorage;
  const randomUuid =
    options.randomUuid ?? (() => crypto.randomUUID());
  const key = installationStorageKey(userId);
  const stored = storage.getItem(key);
  const parsedStored = stored
    ? clientInstallationIdSchema.safeParse(stored)
    : null;
  const id =
    parsedStored?.success === true
      ? parsedStored.data
      : nextInstallationId(randomUuid);

  if (id !== stored) {
    storage.setItem(key, id);
  }

  const client = createWebClientApi(
    options.fetchImpl ?? fetch,
  ).installations;

  try {
    return await registerWebInstallation(client, id);
  } catch (error: unknown) {
    if (!isUnusableInstallationId(error)) {
      throw error;
    }
    const replacementId = nextInstallationId(randomUuid, id);
    storage.setItem(key, replacementId);
    return registerWebInstallation(client, replacementId);
  }
}

export function installationStorageKey(userId: string): string {
  return `${INSTALLATION_STORAGE_PREFIX}${userId}`;
}

function registerWebInstallation(
  client: ReturnType<typeof createWebClientApi>["installations"],
  id: string,
): Promise<ClientInstallationView> {
  return client.register({
    id,
    kind: "WEB",
    appVersion: null,
    protocolVersion: WEB_PROTOCOL_VERSION,
    capabilities: [],
  });
}

function isUnusableInstallationId(error: unknown): boolean {
  return (
    error instanceof ClientApiError &&
    error.code === "not_found"
  );
}

function nextInstallationId(
  randomUuid: () => string,
  previousId?: string,
): string {
  const id = clientInstallationIdSchema.parse(randomUuid());
  if (id === previousId) {
    throw new Error("Generated client installation id did not rotate");
  }
  return id;
}
