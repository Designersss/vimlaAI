import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  SyncDelta,
  SyncResponse,
} from "@vimla/contracts";
import {
  SyncEngine,
  type SyncCursorStore,
} from "./sync-engine.js";

function delta(): SyncDelta {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  return {
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
}

function response(input: {
  deltas?: SyncDelta[];
  nextCursor: string;
  hasMore?: boolean;
}): SyncResponse {
  return {
    syncProtocolVersion: 1,
    deltas: input.deltas ?? [],
    nextCursor: input.nextCursor,
    hasMore: input.hasMore ?? false,
  };
}

function memoryCursor(
  initial: string | null = null,
): SyncCursorStore & {
  value: string | null;
  writes: string[];
  clears: number;
} {
  return {
    value: initial,
    writes: [],
    clears: 0,
    async read() {
      return this.value;
    },
    async write(cursor) {
      this.value = cursor;
      this.writes.push(cursor);
    },
    async clear() {
      this.value = null;
      this.clears += 1;
    },
  };
}

describe("SyncEngine", () => {
  it("drains a bounded snapshot and persists each applied page cursor", async () => {
    const first = delta();
    const second = delta();
    const cursor = memoryCursor();
    const applied: SyncDelta[][] = [];
    const read = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          deltas: [first],
          nextCursor: "cursor.one",
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        response({
          deltas: [second],
          nextCursor: "cursor.two",
        }),
      );
    const engine = new SyncEngine({
      source: { read },
      cursorStore: cursor,
      sink: {
        async apply(deltas) {
          applied.push([...deltas]);
        },
      },
    });

    await engine.start();

    expect(read).toHaveBeenNthCalledWith(1, {});
    expect(read).toHaveBeenNthCalledWith(2, {
      cursor: "cursor.one",
    });
    expect(applied).toEqual([[first], [second]]);
    expect(cursor.writes).toEqual([
      "cursor.one",
      "cursor.two",
    ]);
    expect(engine.state).toBe("IDLE");
  });

  it("coalesces realtime triggers while one sync pass is in flight", async () => {
    let release:
      | ((value: SyncResponse) => void)
      | undefined;
    const firstRead = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    const cursor = memoryCursor();
    const read = vi
      .fn()
      .mockReturnValueOnce(firstRead)
      .mockResolvedValueOnce(
        response({ nextCursor: "cursor.two" }),
      );
    const engine = new SyncEngine({
      source: { read },
      cursorStore: cursor,
      sink: { apply: async () => undefined },
    });

    const starting = engine.start();
    void engine.requestSync();
    void engine.requestSync();
    release?.(
      response({ nextCursor: "cursor.one" }),
    );
    await starting;

    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(2, {
      cursor: "cursor.one",
    });
  });

  it("clears a stale cursor and repairs automatically from the retained stream", async () => {
    const stale = new Error("stale");
    const cursor = memoryCursor("old.cursor");
    const applied = delta();
    const read = vi
      .fn()
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce(
        response({
          deltas: [applied],
          nextCursor: "fresh.cursor",
        }),
      );
    const engine = new SyncEngine({
      source: { read },
      cursorStore: cursor,
      sink: { apply: async () => undefined },
      classifyError: (error) =>
        error === stale ? "CURSOR_STALE" : "RETRY",
    });

    await engine.start();

    expect(cursor.clears).toBe(1);
    expect(read).toHaveBeenNthCalledWith(1, {
      cursor: "old.cursor",
    });
    expect(read).toHaveBeenNthCalledWith(2, {});
    expect(cursor.value).toBe("fresh.cursor");
    expect(engine.state).toBe("IDLE");
  });

  it("does not advance the cursor when applying a page fails and retries later", async () => {
    const cursor = memoryCursor();
    const scheduled: Array<{
      callback: () => void;
      delay: number;
    }> = [];
    const item = delta();
    const read = vi
      .fn()
      .mockResolvedValue(
        response({
          deltas: [item],
          nextCursor: "cursor.one",
        }),
      );
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new Error("apply failed"))
      .mockResolvedValueOnce(undefined);
    const engine = new SyncEngine({
      source: { read },
      cursorStore: cursor,
      sink: { apply },
      retryBaseMs: 25,
      setTimeoutFn: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length as unknown as ReturnType<
          typeof setTimeout
        >;
      },
      clearTimeoutFn: () => undefined,
    });

    await engine.start();

    expect(cursor.writes).toEqual([]);
    expect(engine.state).toBe("RETRY_WAIT");
    expect(scheduled[0]?.delay).toBe(25);

    scheduled[0]?.callback();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(cursor.value).toBe("cursor.one");
  });

  it("never persists a fetched page after the engine is stopped", async () => {
    let release:
      | ((value: SyncResponse) => void)
      | undefined;
    const page = new Promise<SyncResponse>((resolve) => {
      release = resolve;
    });
    const cursor = memoryCursor();
    const apply = vi.fn();
    const engine = new SyncEngine({
      source: { read: async () => page },
      cursorStore: cursor,
      sink: { apply },
    });

    const starting = engine.start();
    engine.stop();
    release?.(
      response({
        deltas: [delta()],
        nextCursor: "cursor.one",
      }),
    );
    await starting;

    expect(apply).not.toHaveBeenCalled();
    expect(cursor.writes).toEqual([]);
    expect(engine.state).toBe("STOPPED");
  });
});
