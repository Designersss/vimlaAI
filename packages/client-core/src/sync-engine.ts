import type {
  SyncDelta,
  SyncResponse,
} from "@vimla/contracts";

export type SyncEngineState =
  | "STOPPED"
  | "IDLE"
  | "SYNCING"
  | "RETRY_WAIT"
  | "TERMINAL";

export type SyncFailureKind =
  | "CURSOR_STALE"
  | "RETRY"
  | "TERMINAL";

export interface SyncCursorStore {
  read(): Promise<string | null>;
  write(cursor: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncPageSource {
  read(options: {
    cursor?: string;
    limit?: number;
  }): Promise<SyncResponse>;
}

export interface SyncDeltaSink {
  apply(deltas: readonly SyncDelta[]): Promise<void>;
}

export interface SyncEngineOptions {
  source: SyncPageSource;
  cursorStore: SyncCursorStore;
  sink: SyncDeltaSink;
  pageSize?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  classifyError?: (error: unknown) => SyncFailureKind;
  onError?: (error: unknown) => void;
  onStateChange?: (state: SyncEngineState) => void;
  setTimeoutFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;
}

const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 10_000;

export class SyncEngine {
  private currentState: SyncEngineState = "STOPPED";
  private stopped = true;
  private queued = false;
  private activeRun: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  constructor(private readonly options: SyncEngineOptions) {}

  get state(): SyncEngineState {
    return this.currentState;
  }

  start(): Promise<void> {
    if (!this.stopped) {
      return this.activeRun ?? Promise.resolve();
    }
    this.stopped = false;
    this.setState("IDLE");
    return this.requestSync();
  }

  stop(): void {
    this.stopped = true;
    this.queued = false;
    this.cancelRetry();
    this.setState("STOPPED");
  }

  requestSync(): Promise<void> {
    if (this.stopped || this.currentState === "TERMINAL") {
      return Promise.resolve();
    }

    this.queued = true;
    this.cancelRetry();
    if (this.activeRun) {
      return this.activeRun;
    }

    const run = this.drain();
    this.activeRun = run.finally(() => {
      this.activeRun = null;
      if (
        this.queued &&
        !this.stopped &&
        this.currentState !== "TERMINAL" &&
        this.retryTimer === null
      ) {
        void this.requestSync();
      }
    });
    return this.activeRun;
  }

  private async drain(): Promise<void> {
    while (this.queued && !this.stopped) {
      this.queued = false;
      this.setState("SYNCING");

      try {
        await this.syncSnapshot();
        this.retryAttempt = 0;
        if (!this.stopped) {
          this.setState("IDLE");
        }
      } catch (error: unknown) {
        if (this.stopped) {
          return;
        }

        const kind = this.classify(error);
        this.options.onError?.(error);
        if (kind === "CURSOR_STALE") {
          try {
            await this.options.cursorStore.clear();
            await this.syncSnapshot();
            this.retryAttempt = 0;
            if (!this.stopped) {
              this.setState("IDLE");
            }
            continue;
          } catch (resetError: unknown) {
            if (this.stopped) {
              return;
            }
            this.options.onError?.(resetError);
            this.handleFailure(
              resetError,
              this.classify(resetError),
            );
            return;
          }
        }

        this.handleFailure(error, kind);
        return;
      }
    }
  }

  private async syncSnapshot(): Promise<void> {
    let cursor = await this.options.cursorStore.read();

    while (!this.stopped) {
      const response = await this.options.source.read({
        ...(cursor === null ? {} : { cursor }),
        ...(this.options.pageSize === undefined
          ? {}
          : { limit: this.options.pageSize }),
      });
      if (this.stopped) {
        return;
      }

      if (response.deltas.length > 0) {
        await this.options.sink.apply(response.deltas);
        if (this.stopped) {
          return;
        }
      }

      if (
        response.hasMore &&
        response.nextCursor === cursor
      ) {
        throw new Error("sync_cursor_did_not_advance");
      }

      await this.options.cursorStore.write(
        response.nextCursor,
      );
      cursor = response.nextCursor;

      if (!response.hasMore) {
        return;
      }
    }
  }

  private handleFailure(
    _error: unknown,
    kind: SyncFailureKind,
  ): void {
    if (kind === "TERMINAL") {
      this.queued = false;
      this.setState("TERMINAL");
      return;
    }

    const delay = retryDelay(
      this.retryAttempt,
      this.options.retryBaseMs ??
        DEFAULT_RETRY_BASE_MS,
      this.options.retryMaxMs ??
        DEFAULT_RETRY_MAX_MS,
    );
    this.retryAttempt += 1;
    this.queued = true;
    this.setState("RETRY_WAIT");
    const setTimeoutFn =
      this.options.setTimeoutFn ?? setTimeout;
    this.retryTimer = setTimeoutFn(() => {
      this.retryTimer = null;
      void this.requestSync();
    }, delay);
  }

  private classify(error: unknown): SyncFailureKind {
    return this.options.classifyError?.(error) ?? "RETRY";
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) {
      return;
    }
    const clearTimeoutFn =
      this.options.clearTimeoutFn ?? clearTimeout;
    clearTimeoutFn(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(state: SyncEngineState): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;
    this.options.onStateChange?.(state);
  }
}

export function retryDelay(
  attempt: number,
  baseMs = DEFAULT_RETRY_BASE_MS,
  maxMs = DEFAULT_RETRY_MAX_MS,
): number {
  return Math.min(
    maxMs,
    baseMs * 2 ** Math.min(Math.max(attempt, 0), 8),
  );
}
