import { createHash } from "node:crypto";
import type { EmbeddingModel } from "@vimla/ai";
export const SEMANTIC_CHUNK_VERSION = "utf8-2048-v1";
export const semanticHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export function semanticGeneration(identity: EmbeddingModel): string {
  return semanticHash(
    JSON.stringify([
      identity.provider,
      identity.model,
      identity.revision,
      identity.dimensions,
      SEMANTIC_CHUNK_VERSION,
    ]),
  );
}
/** Lossless code-point chunks. Never silently truncate a source. */
export function semanticChunks(text: string): string[] {
  if (!text.trim() || Buffer.byteLength(text) > 65536) return [];
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point);
    if (bytes + size > 2048) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += point;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.length <= 32 ? chunks : [];
}
export function lexicalRelevance(query: string, text: string): number {
  const tokens = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const source = new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return tokens.size
    ? [...tokens].filter((token) => source.has(token)).length / tokens.size
    : 0;
}
export function hybridRelevance(
  lexical: number,
  semantic: number,
  entity: boolean,
): number {
  return Math.min(
    1,
    Math.max(
      lexical,
      0.7 * Math.max(0, semantic) + 0.3 * lexical,
      entity ? 1 : 0,
    ),
  );
}
