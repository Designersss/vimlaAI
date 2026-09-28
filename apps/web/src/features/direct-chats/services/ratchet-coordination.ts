import type { SerializedRatchetState, X3dhInitHeader } from "@vimla/e2ee";

export const RATCHET_RECORD_SCHEMA_VERSION = 1 as const;
export const LEGACY_RATCHET_RECORD_SCHEMA_VERSION = 0 as const;

export interface StoredRatchetRecord {
  schemaVersion: typeof RATCHET_RECORD_SCHEMA_VERSION;
  localDeviceId: string;
  stateVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}

export interface StoredLegacyRatchetRecord {
  schemaVersion: typeof LEGACY_RATCHET_RECORD_SCHEMA_VERSION;
  localDeviceId: string;
  state: SerializedRatchetState;
}

export interface RatchetSnapshot {
  stateVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}

export interface RatchetLeaseRecord {
  owner: string;
  expiresAt: number;
  fence?: number;
  hardExpiresAt?: number;
}

export class RatchetStateConflictError extends Error {
  constructor() {
    super("Ratchet state changed concurrently");
    this.name = "RatchetStateConflictError";
  }
}

export class RatchetLockLostError extends Error {
  constructor() {
    super("Ratchet lock ownership was lost");
    this.name = "RatchetLockLostError";
  }
}

export class RatchetStateCorruptError extends Error {
  constructor() {
    super("Persisted ratchet state is invalid");
    this.name = "RatchetStateCorruptError";
  }
}

export function decodeStoredRatchet(
  value: unknown,
  localDeviceId: string,
): RatchetSnapshot | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (isStoredRatchetRecord(value)) {
    if (value.localDeviceId !== localDeviceId) {
      throw new RatchetStateCorruptError();
    }
    return {
      stateVersion: value.stateVersion,
      state: value.state,
      pendingX3dhInit: value.pendingX3dhInit,
    };
  }
  if (isStoredLegacyRatchetRecord(value)) {
    if (value.localDeviceId !== localDeviceId) {
      throw new RatchetStateCorruptError();
    }
    return {
      stateVersion: 0,
      state: value.state,
      pendingX3dhInit: null,
    };
  }
  throw new RatchetStateCorruptError();
}

export function markLegacyRatchetOwner(
  value: unknown,
  localDeviceId: string,
): unknown {
  if (!isSerializedRatchetState(value)) {
    return value;
  }
  return {
    schemaVersion: LEGACY_RATCHET_RECORD_SCHEMA_VERSION,
    localDeviceId,
    state: value,
  } satisfies StoredLegacyRatchetRecord;
}

export function storedRatchetRecord(input: {
  localDeviceId: string;
  stateVersion: number;
  state: SerializedRatchetState;
  pendingX3dhInit: X3dhInitHeader | null;
}): StoredRatchetRecord {
  if (!Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1) {
    throw new RatchetStateCorruptError();
  }
  return {
    schemaVersion: RATCHET_RECORD_SCHEMA_VERSION,
    localDeviceId: input.localDeviceId,
    stateVersion: input.stateVersion,
    state: input.state,
    pendingX3dhInit: input.pendingX3dhInit,
  };
}

export function assertRatchetVersion(
  current: RatchetSnapshot | null,
  expectedVersion: number,
): void {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    (current?.stateVersion ?? 0) !== expectedVersion
  ) {
    throw new RatchetStateConflictError();
  }
}

export function canAcquireRatchetLease(
  current: RatchetLeaseRecord | null,
  owner: string,
  now: number,
): boolean {
  return (
    current === null ||
    current.owner === owner ||
    current.expiresAt <= now
  );
}

export function acquireRatchetLeaseRecord(input: {
  current: RatchetLeaseRecord | null;
  owner: string;
  now: number;
  leaseMs: number;
  maxHoldMs: number;
}): { fence: number; record: RatchetLeaseRecord } | null {
  if (
    !Number.isFinite(input.leaseMs) ||
    input.leaseMs <= 0 ||
    !Number.isFinite(input.maxHoldMs) ||
    input.maxHoldMs < input.leaseMs ||
    !canAcquireRatchetLease(
      input.current,
      input.owner,
      input.now,
    )
  ) {
    return null;
  }
  const currentFence = input.current?.fence ?? 0;
  const fence =
    input.current?.owner === input.owner
      ? Math.max(1, currentFence)
      : currentFence + 1;
  const hardExpiresAt =
    input.current?.owner === input.owner &&
    input.current.hardExpiresAt !== undefined &&
    input.current.hardExpiresAt > input.now
      ? input.current.hardExpiresAt
      : input.now + input.maxHoldMs;
  return {
    fence,
    record: {
      owner: input.owner,
      fence,
      hardExpiresAt,
      expiresAt: Math.min(
        input.now + input.leaseMs,
        hardExpiresAt,
      ),
    },
  };
}

export function renewRatchetLeaseRecord(input: {
  current: RatchetLeaseRecord | null;
  owner: string;
  fence: number;
  now: number;
  leaseMs: number;
}): RatchetLeaseRecord | null {
  const current = input.current;
  if (
    !current ||
    current.owner !== input.owner ||
    (current.fence ?? 0) !== input.fence ||
    current.expiresAt <= input.now
  ) {
    return null;
  }
  const hardExpiresAt =
    current.hardExpiresAt ?? current.expiresAt;
  if (hardExpiresAt <= input.now) {
    return null;
  }
  return {
    owner: input.owner,
    fence: input.fence,
    hardExpiresAt,
    expiresAt: Math.min(
      input.now + input.leaseMs,
      hardExpiresAt,
    ),
  };
}

export function isRatchetLeaseRecord(
  value: unknown,
): value is RatchetLeaseRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.owner === "string" &&
    value.owner.length > 0 &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    (value.fence === undefined ||
      (typeof value.fence === "number" &&
        Number.isSafeInteger(value.fence) &&
        value.fence >= 0)) &&
    (value.hardExpiresAt === undefined ||
      (typeof value.hardExpiresAt === "number" &&
        Number.isFinite(value.hardExpiresAt)))
  );
}

function isStoredLegacyRatchetRecord(
  value: unknown,
): value is StoredLegacyRatchetRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion ===
      LEGACY_RATCHET_RECORD_SCHEMA_VERSION &&
    typeof value.localDeviceId === "string" &&
    value.localDeviceId.length > 0 &&
    isSerializedRatchetState(value.state)
  );
}

function isStoredRatchetRecord(
  value: unknown,
): value is StoredRatchetRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === RATCHET_RECORD_SCHEMA_VERSION &&
    typeof value.localDeviceId === "string" &&
    value.localDeviceId.length > 0 &&
    typeof value.stateVersion === "number" &&
    Number.isSafeInteger(value.stateVersion) &&
    value.stateVersion >= 1 &&
    isSerializedRatchetState(value.state) &&
    (value.pendingX3dhInit === null ||
      isX3dhInitHeader(value.pendingX3dhInit))
  );
}

function isX3dhInitHeader(
  value: unknown,
): value is X3dhInitHeader {
  if (!isRecord(value)) return false;
  return (
    typeof value.identityEd25519Public === "string" &&
    typeof value.identityX25519Public === "string" &&
    typeof value.ephemeralPublic === "string" &&
    typeof value.signedPrekeyId === "number" &&
    Number.isSafeInteger(value.signedPrekeyId) &&
    value.signedPrekeyId >= 0 &&
    (value.oneTimePrekeyId === null ||
      (typeof value.oneTimePrekeyId === "number" &&
        Number.isSafeInteger(value.oneTimePrekeyId) &&
        value.oneTimePrekeyId >= 0))
  );
}

function isSerializedRatchetState(
  value: unknown,
): value is SerializedRatchetState {
  if (!isRecord(value)) return false;
  if (
    typeof value.dhsSecret !== "string" ||
    typeof value.dhsPublic !== "string" ||
    (value.dhrPublic !== null &&
      typeof value.dhrPublic !== "string") ||
    typeof value.rootKey !== "string" ||
    (value.sendingChainKey !== null &&
      typeof value.sendingChainKey !== "string") ||
    (value.receivingChainKey !== null &&
      typeof value.receivingChainKey !== "string") ||
    !isCounter(value.ns) ||
    !isCounter(value.nr) ||
    !isCounter(value.pn) ||
    !isRecord(value.skipped)
  ) {
    return false;
  }
  return Object.values(value.skipped).every(
    (entry) => typeof entry === "string",
  );
}

function isCounter(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
