import { describe, expect, it } from "vitest";
import { filterCatalogModels, uniqueModelVendors } from "./model-filters";

const models = [
  { id: "1", displayName: "GPT-5.6 Luna", vendor: "openai", supportsStreaming: true },
  { id: "2", displayName: "Claude Haiku 4.5", vendor: "anthropic", supportsStreaming: true },
  { id: "3", displayName: "Gemini 3.5 Flash Lite", vendor: "google", supportsStreaming: false },
];

describe("filterCatalogModels", () => {
  it("filters by vendor from real catalog metadata", () => {
    expect(uniqueModelVendors(models)).toEqual(["anthropic", "google", "openai"]);
    expect(filterCatalogModels(models, "", "openai", false).map((model) => model.id)).toEqual(["1"]);
  });

  it("filters by search and streaming without invented categories", () => {
    expect(filterCatalogModels(models, "claude", "all", false)).toHaveLength(1);
    expect(filterCatalogModels(models, "", "all", true)).toHaveLength(2);
  });
});
