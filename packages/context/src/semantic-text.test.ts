import { describe, expect, it } from "vitest";
import {
  hybridRelevance,
  semanticChunks,
  semanticGeneration,
} from "./semantic-text.js";
describe("semantic text", () => {
  it("chunks Unicode without splitting code points or losing source bytes", () => {
    const text = "Привет 🌍 résumé 日本語 ".repeat(1000);
    const chunks = semanticChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    expect(
      chunks.every(
        (chunk) =>
          Buffer.byteLength(chunk) <= 2048 && !chunk.includes("\ufffd"),
      ),
    ).toBe(true);
  });
  it("rejects oversized sources rather than silently indexing a prefix", () => {
    expect(semanticChunks("x".repeat(65537))).toEqual([]);
    expect(semanticChunks(" ")).toEqual([]);
  });
  it("separates model revisions, dimensions and providers", () => {
    const model = {
      provider: "internal",
      model: "m",
      revision: "v1",
      dimensions: 768,
    };
    const generation = semanticGeneration(model);
    for (const changed of [
      { ...model, revision: "v2" },
      { ...model, dimensions: 384 },
      { ...model, provider: "other" },
    ]) {
      expect(semanticGeneration(changed)).not.toBe(generation);
    }
  });
  it("retains lexical and explicit reference evidence in hybrid scoring", () => {
    expect(hybridRelevance(1, 0.2, false)).toBe(1);
    expect(hybridRelevance(0, 0.9, false)).toBeCloseTo(0.63);
    expect(hybridRelevance(0, 0, true)).toBe(1);
  });
});
