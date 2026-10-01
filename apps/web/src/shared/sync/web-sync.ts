import type { SyncDelta } from "@vimla/contracts";
import {
  AuthRequiredError,
  ClientApiError,
} from "@vimla/client-api";
import {
  SyncEngine,
  retryDelay,
  type SyncCursorStore,
  type SyncFailureKind,
} from "@vimla/client-core";
import { ensureWebInstallation } from "../../features/installations/services/installation";
import { createWebClientApi } from "../api/client";
import {
  subscribeRealtime,
  type SubscribeRealtimeOptions,
} from "../realtime/realtime";

const CURSOR_STORAGE_PREFIX = "vimla:sync-cursor:v1:";

export interface WebSyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EventTargetLike {
  addEventListener(
    type: string,
    listener: () => void,
  ): void;
  removeEventListener(
    type: string,
    listener: () => void,
  ): void;
}

interface VisibilityTargetLike extends EventTargetLike {
  readonly visibilityState: string;
}

type InstallationBootstrap = (
  userId: string,
) => Promise<{ id: string }>;

type RealtimeSubscribe = (
  options: SubscribeRealtimeOptions,
) => () => void;

export interface SubscribeWebSyncOptions {
  userId: string;
  onDeltas: (
    deltas: readonly SyncDelta[],
  ) => Promise<void> | void;
  onAuthRequired?: () => void;
  onError?: (error: unknown) => void;
  storage?: WebSyncStorage;
  fetchImpl?: typeof fetch;
  ensureInstallation?: InstallationBootstrap;
  realtimeSubscribe?: RealtimeSubscribe;
  windowTarget?: EventTargetLike;
  documentTarget?: VisibilityTargetLike;
  setTimeoutFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;
}

export function subscribeWebSync(
  options: SubscribeWebSyncOptions,
): () => void {
  const storage =
    options.storage ?? window.sessionStorage;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cursorStore = createWebSyncCursorStore(
    options.userId,
    storage,
  );
  const api = createWebClientApi(fetchImpl);
  const setTimeoutFn =
    options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn =
    options.clearTimeoutFn ?? clearTimeout;
  const installationBootstrap =
    options.ensureInstallation ??
    ((userId: string) =>
      ensureWebInstallation(userId));
  const realtimeSubscribe =
    options.realtimeSubscribe ?? subscribeRealtime;

  let stopped = false;
  let realtimeStop: (() => void) | null = null;
  let realtimeConnecting = false;
  let realtimeRetryAttempt = 0;
  let realtimeRetry:
    | ReturnType<typeof setTimeout>
    | null = null;

  const engine = new SyncEngine({
    source: api.sync,
    cursorStore,
    sink: {
      apply: async (deltas) => {
        await options.onDeltas(deltas);
      },
    },
    classifyError: classifySyncError,
    onError: (error) => {
      if (error instanceof AuthRequiredError) {
        options.onAuthRequired?.();
      }
      options.onError?.(error);
    },
    setTimeoutFn,
    clearTimeoutFn,
  });

  const requestSync = (): void => {
    if (!stopped) {
      void engine.requestSync();
    }
  };

  const clearRealtimeRetry = (): void => {
    if (realtimeRetry === null) {
      return;
    }
    clearTimeoutFn(realtimeRetry);
    realtimeRetry = null;
  };

  const scheduleRealtimeRetry = (): void => {
    if (
      stopped ||
      realtimeStop !== null ||
      realtimeRetry !== null
    ) {
      return;
    }
    const delay = retryDelay(
      realtimeRetryAttempt,
    );
    realtimeRetryAttempt += 1;
    realtimeRetry = setTimeoutFn(() => {
      realtimeRetry = null;
      void connectRealtime();
    }, delay);
  };

  const connectRealtime = async (): Promise<void> => {
    if (
      stopped ||
      realtimeConnecting ||
      realtimeStop !== null
    ) {
      return;
    }
    realtimeConnecting = true;
    try {
      const installation =
        await installationBootstrap(options.userId);
      if (stopped) {
        return;
      }
      realtimeRetryAttempt = 0;
      realtimeStop = realtimeSubscribe({
        installationId: installation.id,
        onOpen: requestSync,
        onHeartbeat: requestSync,
        onEvent: (event) => {
          if (event.durability === "DURABLE_HINT") {
            requestSync();
          }
        },
      });
    } catch (error: unknown) {
      if (stopped) {
        return;
      }
      if (error instanceof AuthRequiredError) {
        options.onAuthRequired?.();
        options.onError?.(error);
        return;
      }
      options.onError?.(error);
      scheduleRealtimeRetry();
    } finally {
      realtimeConnecting = false;
    }
  };

  const windowTarget =
    options.windowTarget ?? window;
  const documentTarget =
    options.documentTarget ?? document;

  const onOnline = (): void => {
    requestSync();
    if (realtimeStop === null) {
      clearRealtimeRetry();
      void connectRealtime();
    }
  };
  const onPageShow = (): void => {
    requestSync();
  };
  const onVisibility = (): void => {
    if (
      documentTarget.visibilityState === "visible"
    ) {
      requestSync();
      if (realtimeStop === null) {
        clearRealtimeRetry();
        void connectRealtime();
      }
    }
  };

  windowTarget.addEventListener("online", onOnline);
  windowTarget.addEventListener("pageshow", onPageShow);
  documentTarget.addEventListener(
    "visibilitychange",
    onVisibility,
  );

  void engine.start();
  void connectRealtime();

  return () => {
    stopped = true;
    clearRealtimeRetry();
    realtimeStop?.();
    realtimeStop = null;
    engine.stop();
    windowTarget.removeEventListener(
      "online",
      onOnline,
    );
    windowTarget.removeEventListener(
      "pageshow",
      onPageShow,
    );
    documentTarget.removeEventListener(
      "visibilitychange",
      onVisibility,
    );
  };
}

export function createWebSyncCursorStore(
  userId: string,
  storage: WebSyncStorage,
): SyncCursorStore {
  const key = webSyncCursorStorageKey(userId);
  return {
    async read() {
      return storage.getItem(key);
    },
    async write(cursor) {
      storage.setItem(key, cursor);
    },
    async clear() {
      storage.removeItem(key);
    },
  };
}

export function webSyncCursorStorageKey(
  userId: string,
): string {
  return `${CURSOR_STORAGE_PREFIX}${userId}`;
}

export function classifySyncError(
  error: unknown,
): SyncFailureKind {
  if (error instanceof AuthRequiredError) {
    return "TERMINAL";
  }
  if (
    error instanceof ClientApiError &&
    (error.code === "sync_cursor_stale" ||
      error.code === "sync_cursor_invalid")
  ) {
    return "CURSOR_STALE";
  }
  return "RETRY";
}
