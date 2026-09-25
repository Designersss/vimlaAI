import type { SerializedRatchetState } from "@vimla/e2ee";

export const RATCHET_RECORD_SCHEMA_VERSION = 1 as const;

export interface StoredRatchetRecord {
  schemaVersion: typeof RATCHET_RECORD_SCHEMA_VERSION;
  localDeviceId: string;
  stateVersion: number;
  state: SerializedRatchetState;
}

export interface RatchetSnapshot {
  stateVersion: number;
  state: SerializedRatchetState;
}

export interface RatchetLeaseRecord {
  owner: string;
  expiresAt: number;
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
      return null;
    }
    return {
      stateVersion: value.stateVersion,
      state: value.state,
    };
  }
  if (isSerializedRatchetState(value)) {
    return {
      stateVersion: 0,
      state: value,
    };
  }
  throw new RatchetStateCorruptError();
}

export function storedRatchetRecord(input: {
  localDeviceId: string;
  stateVersion: number;
  state: SerializedRatchetState;
}): StoredRatchetRecord {
  if (!Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1) {
    throw new RatchetStateCorruptError();
  }
  return {
    schemaVersion: RATCHET_RECORD_SCHEMA_VERSION,
    localDeviceId: input.localDeviceId,
    stateVersion: input.stateVersion,
    state: input.state,
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

export function isRatchetLeaseRecord(
  value: unknown,
): value is RatchetLeaseRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.owner === "string" &&
    value.owner.length > 0 &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
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
    isSerializedRatchetState(value.state)
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
