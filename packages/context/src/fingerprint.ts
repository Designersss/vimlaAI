import { createHash } from "node:crypto";
import type { Prisma } from "@vimla/database";
import type { ContextSnapshotItemInput } from "./types.js";

export function fingerprintContextItem(item: ContextSnapshotItemInput): string {
  return sha256(
    canonicalJson({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceVersion: item.sourceVersion ?? null,
      classification: item.classification,
      contentRef: item.contentRef ?? null,
      metadata: item.metadata ?? null,
    }),
  );
}

export function fingerprintContextSnapshot(items: readonly ContextSnapshotItemInput[]): string {
  return sha256(items.map((item) => fingerprintContextItem(item)).join("\n"));
}

export function canonicalJson(value: Prisma.InputJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Context JSON cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
