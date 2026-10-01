import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AuthRequiredError,
  ClientApiError,
} from "@vimla/client-api";
import type { RealtimeEventEnvelope, SyncDelta, SyncResponse } from "@vimla/contracts";
import {
  classifySyncError,
  createWebSyncCursorStore,
  subscribeWebSync,
  webSyncCursorStorageKey,
  type WebSyncStorage,
} from "./web-sync";

class MemoryStorage implements WebSyncStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("Web sync adapter", () => {
  it("keeps the durable cursor scoped to the authenticated user", async () => {
    const storage = new MemoryStorage();
    const firstUser = randomUUID();
    const secondUser = randomUUID();
    const first = createWebSyncCursorStore(
      firstUser,
      storage,
    );
    const second = createWebSyncCursorStore(
      secondUser,
      storage,
    );

    await first.write("cursor.one");

    expect(await first.read()).toBe("cursor.one");
    expect(await second.read()).toBeNull();
    expect(
      webSyncCursorStorageKey(firstUser),
    ).not.toBe(
      webSyncCursorStorageKey(secondUser),
    );

    await first.clear();
    expect(await first.read()).toBeNull();
  });

  it("self-heals stale or locally corrupted cursor tokens", () => {
    expect(
      classifySyncError(
        new ClientApiError(
          "sync_cursor_stale",
          409,
        ),
      ),
    ).toBe("CURSOR_STALE");
    expect(
      classifySyncError(
        new ClientApiError(
          "sync_cursor_invalid",
          400,
        ),
      ),
    ).toBe("CURSOR_STALE");
  });

  it("treats authentication loss as terminal and transient failures as retryable", () => {
    expect(
      classifySyncError(new AuthRequiredError()),
    ).toBe("TERMINAL");
    expect(
      classifySyncError(
        new ClientApiError("rate_limited", 429),
      ),
    ).toBe("RETRY");
    expect(
      classifySyncError(new Error("offline")),
    ).toBe("RETRY");
  });

  it("uses heartbeat to recover a durable change even when its event frame was lost", async () => {
    const storage = new MemoryStorage();
    const userId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const delta: SyncDelta = {
      syncProtocolVersion: 1,
      eventId: messageId,
      eventType: "DIRECT_MESSAGE_CREATED",
      changeKind: "UPSERT_REF",
      scope: {
        kind: "DIRECT_CHAT",
        id: conversationId,
      },
      occurredAt: new Date().toISOString(),
      payload: {
        conversationId,
        messageId,
      },
    };
    const pages: SyncResponse[] = [
      {
        syncProtocolVersion: 1,
        deltas: [],
        nextCursor: "cursor.one",
        hasMore: false,
      },
      {
        syncProtocolVersion: 1,
        deltas: [delta],
        nextCursor: "cursor.two",
        hasMore: false,
      },
    ];
    const fetchImpl = vi.fn(async () => {
      const page = pages.shift();
      if (!page) {
        throw new Error("unexpected sync request");
      }
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;
    let realtime:
      | Parameters<
          NonNullable<
            Parameters<
              typeof subscribeWebSync
            >[0]["realtimeSubscribe"]
          >
        >[0]
      | null = null;
    const onDeltas = vi.fn(async () => undefined);
    const eventTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const documentTarget = {
      ...eventTarget,
      visibilityState: "visible",
    };
    const stop = subscribeWebSync({
      userId,
      storage,
      fetchImpl,
      onDeltas,
      ensureInstallation: async () => ({
        id: randomUUID(),
      }),
      realtimeSubscribe: (options) => {
        realtime = options;
        return () => undefined;
      },
      windowTarget: eventTarget,
      documentTarget,
    });

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(
        storage.getItem(
          webSyncCursorStorageKey(userId),
        ),
      ).toBe("cursor.one");
      expect(realtime).not.toBeNull();
    });

    // No EVENT is delivered. The next heartbeat still repairs
    // the committed change through the durable cursor stream.
    realtime?.onHeartbeat?.();

    await vi.waitFor(() => {
      expect(onDeltas).toHaveBeenCalledWith([
        delta,
      ]);
      expect(
        storage.getItem(
          webSyncCursorStorageKey(userId),
        ),
      ).toBe("cursor.two");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    stop();
  });

  it("keeps reload state in one tab without sharing progress with another tab", async () => {
    const userId = randomUUID();
    const firstTab = new MemoryStorage();
    const secondTab = new MemoryStorage();
    const beforeReload = createWebSyncCursorStore(
      userId,
      firstTab,
    );
    await beforeReload.write("cursor.saved");

    const afterReload = createWebSyncCursorStore(
      userId,
      firstTab,
    );
    const otherTab = createWebSyncCursorStore(
      userId,
      secondTab,
    );

    expect(await afterReload.read()).toBe(
      "cursor.saved",
    );
    expect(await otherTab.read()).toBeNull();
  });

});
