import { afterEach, describe, expect, it } from "vitest";
import {
  clearLocalDeviceRevocationLatch,
  isLocalDeviceRevoked,
  markLocalDeviceRevoked,
} from "./revocation-state";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

function installStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function memoryStorage(
  options: {
    failReads?: boolean;
    failWrites?: boolean;
  } = {},
): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      if (options.failReads) {
        throw new DOMException(
          "Storage read denied",
          "SecurityError",
        );
      }
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      if (options.failWrites) {
        throw new DOMException(
          "Storage write denied",
          "QuotaExceededError",
        );
      }
      values.set(key, value);
    },
  };
}

afterEach(() => {
  clearLocalDeviceRevocationLatch();
  if (originalStorage) {
    Object.defineProperty(
      globalThis,
      "localStorage",
      originalStorage,
    );
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("local E2EE revocation latch", () => {
  it("shares persisted revocation state and clears it", () => {
    installStorage(memoryStorage());

    expect(isLocalDeviceRevoked()).toBe(false);
    markLocalDeviceRevoked();
    expect(isLocalDeviceRevoked()).toBe(true);
    clearLocalDeviceRevocationLatch();
    expect(isLocalDeviceRevoked()).toBe(false);
  });

  it("remains fail closed when storage becomes unreadable after persistence", () => {
    const storage = memoryStorage();
    installStorage(storage);

    markLocalDeviceRevoked();
    installStorage(
      memoryStorage({ failReads: true }),
    );

    expect(isLocalDeviceRevoked()).toBe(true);
  });

  it("remains fail closed when storage writes are denied", () => {
    installStorage(memoryStorage({ failWrites: true }));

    markLocalDeviceRevoked();

    expect(isLocalDeviceRevoked()).toBe(true);
  });
});
