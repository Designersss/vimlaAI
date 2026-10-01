import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthRequiredError,
  ClientApiError,
} from "@vimla/client-api";
import {
  classifySyncError,
  createWebSyncCursorStore,
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
});
