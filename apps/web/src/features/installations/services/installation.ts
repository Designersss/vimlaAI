import {
  clientInstallationIdSchema,
  type ClientInstallationView,
} from "@vimla/contracts";
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
  const id =
    stored && clientInstallationIdSchema.safeParse(stored).success
      ? stored
      : randomUuid();

  if (id !== stored) {
    storage.setItem(key, id);
  }

  return createWebClientApi(
    options.fetchImpl ?? fetch,
  ).installations.register({
    id,
    kind: "WEB",
    appVersion: null,
    protocolVersion: WEB_PROTOCOL_VERSION,
    capabilities: [],
  });
}

export function installationStorageKey(userId: string): string {
  return `${INSTALLATION_STORAGE_PREFIX}${userId}`;
}
