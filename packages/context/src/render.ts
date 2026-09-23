import type { ContextSnapshotItemView } from "./types.js";

const MAX_RENDERED_CONTEXT_BYTES = 512 * 1024;
const INTERNAL_METADATA_KEYS = new Set([
  "retrieval",
  "fingerprint",
  "sourceRefHash",
  "artifactRefHash",
]);

export function renderContextBundleItems(
  items: readonly ContextSnapshotItemView[],
): string | null {
  if (items.length === 0) return null;

  const blocks = items.map((item) => {
    const metadata = sanitizeForExecutor(item.metadata);
    return [
      "[CONTEXT " + item.sourceType + "]",
      JSON.stringify(metadata),
    ].join("\n");
  });
  const rendered = blocks.join("\n\n");
  const byteLength = new TextEncoder().encode(rendered).byteLength;
  if (byteLength > MAX_RENDERED_CONTEXT_BYTES) {
    throw new Error("Packed context exceeds the renderer safety bound");
  }
  return rendered;
}

function sanitizeForExecutor(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 8) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 128)
      .map((entry) => sanitizeForExecutor(entry, depth + 1));
  }
  if (typeof value !== "object") return null;

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      INTERNAL_METADATA_KEYS.has(key) ||
      key === "id" ||
      key.endsWith("Id")
    ) {
      continue;
    }
    sanitized[key] = sanitizeForExecutor(entry, depth + 1);
  }
  return sanitized;
}
