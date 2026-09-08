export const PLAN_ENTITLEMENT_KEYS = [
  "projects.max",
  "projects.membersPerProject",
  "projects.ownedActiveMax",
  "projects.externalActiveMax",
  "projects.membersPerOwnedProjectMax",
  "ai.manualModelSelection",
  "ai.auto.minimum",
  "ai.auto.medium",
  "ai.auto.maximum",
  "storage.maxBytes",
  "billing.topupAllowed",
] as const;

export type PlanEntitlementKey = (typeof PLAN_ENTITLEMENT_KEYS)[number];

export const DEPRECATED_PROJECT_ENTITLEMENT_KEYS = [
  "projects.max",
  "projects.membersPerProject",
] as const;

export type DeprecatedProjectEntitlementKey = (typeof DEPRECATED_PROJECT_ENTITLEMENT_KEYS)[number];

export const CANONICAL_PROJECT_ENTITLEMENT_KEYS = [
  "projects.ownedActiveMax",
  "projects.externalActiveMax",
  "projects.membersPerOwnedProjectMax",
] as const;

export type CanonicalProjectEntitlementKey = (typeof CANONICAL_PROJECT_ENTITLEMENT_KEYS)[number];

export type EntitlementValueKind = "COUNT" | "BYTES" | "BOOLEAN" | "TBD";

export type EntitlementValue =
  | { kind: "COUNT" | "BYTES"; unlimited: true }
  | { kind: "COUNT" | "BYTES"; unlimited: false; value: bigint }
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "TBD" };

export interface PlanEntitlementRecord {
  key: PlanEntitlementKey;
  value: EntitlementValue;
}

const KEY_KIND: Record<PlanEntitlementKey, EntitlementValueKind> = {
  "projects.max": "COUNT",
  "projects.membersPerProject": "COUNT",
  "projects.ownedActiveMax": "COUNT",
  "projects.externalActiveMax": "COUNT",
  "projects.membersPerOwnedProjectMax": "COUNT",
  "ai.manualModelSelection": "BOOLEAN",
  "ai.auto.minimum": "TBD",
  "ai.auto.medium": "TBD",
  "ai.auto.maximum": "TBD",
  "storage.maxBytes": "BYTES",
  "billing.topupAllowed": "BOOLEAN",
};

export function isPlanEntitlementKey(key: string): key is PlanEntitlementKey {
  return (PLAN_ENTITLEMENT_KEYS as readonly string[]).includes(key);
}

export function isDeprecatedProjectEntitlementKey(
  key: string,
): key is DeprecatedProjectEntitlementKey {
  return (DEPRECATED_PROJECT_ENTITLEMENT_KEYS as readonly string[]).includes(key);
}

export function assertKnownEntitlementKey(key: string): PlanEntitlementKey {
  if (!isPlanEntitlementKey(key)) {
    throw new Error(`Unknown entitlement key: ${key}`);
  }
  return key;
}

export function assertWritableEntitlementKey(key: string): PlanEntitlementKey {
  const known = assertKnownEntitlementKey(key);
  if (isDeprecatedProjectEntitlementKey(known)) {
    throw new Error(`Deprecated entitlement key is not writable: ${known}`);
  }
  return known;
}

export function expectedKindForKey(key: PlanEntitlementKey): EntitlementValueKind {
  return KEY_KIND[key];
}

export function encodeEntitlement(value: EntitlementValue): {
  valueKind: EntitlementValueKind;
  unlimited: boolean;
  intValue: bigint | null;
  boolValue: boolean | null;
} {
  if (value.kind === "TBD") {
    return { valueKind: "TBD", unlimited: false, intValue: null, boolValue: null };
  }
  if (value.kind === "BOOLEAN") {
    return { valueKind: "BOOLEAN", unlimited: false, intValue: null, boolValue: value.value };
  }
  if (value.unlimited) {
    return { valueKind: value.kind, unlimited: true, intValue: null, boolValue: null };
  }
  return { valueKind: value.kind, unlimited: false, intValue: value.value, boolValue: null };
}

export function decodeEntitlement(row: {
  key: string;
  valueKind: string;
  unlimited: boolean;
  intValue: bigint | null;
  boolValue: boolean | null;
}): PlanEntitlementRecord {
  const key = assertKnownEntitlementKey(row.key);
  if (row.valueKind === "TBD") {
    return { key, value: { kind: "TBD" } };
  }
  const expected = expectedKindForKey(key);
  if (row.valueKind !== expected) {
    throw new Error(`Entitlement ${key} must be ${expected}`);
  }
  if (row.valueKind === "BOOLEAN") {
    if (row.boolValue === null) {
      throw new Error(`Entitlement ${key} is missing a boolean value`);
    }
    return { key, value: { kind: "BOOLEAN", value: row.boolValue } };
  }
  if (row.unlimited) {
    return { key, value: { kind: row.valueKind as "COUNT" | "BYTES", unlimited: true } };
  }
  if (row.intValue === null) {
    throw new Error(`Entitlement ${key} is missing a limited value`);
  }
  return {
    key,
    value: { kind: row.valueKind as "COUNT" | "BYTES", unlimited: false, value: row.intValue },
  };
}

export function isTopupAllowed(entitlements: readonly PlanEntitlementRecord[]): boolean {
  const match = entitlements.find((item) => item.key === "billing.topupAllowed");
  if (!match) {
    return true;
  }
  return match.value.kind === "BOOLEAN" ? match.value.value : true;
}
