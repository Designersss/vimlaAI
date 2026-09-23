import type { ContextSnapshotItemView } from "./types.js";

const MAX_RENDERED_CONTEXT_BYTES = 512 * 1024;

export function renderContextBundleItems(
  items: readonly ContextSnapshotItemView[],
): string | null {
  if (items.length === 0) return null;

  const blocks = items.map((item) => {
    const metadata = stripRetrievalMetadata(item.metadata);
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

function stripRetrievalMetadata(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }
  const { retrieval: _retrieval, ...rest } = value as Record<
    string,
    unknown
  >;
  return rest;
}
