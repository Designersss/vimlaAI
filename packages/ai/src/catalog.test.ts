import { describe, expect, it } from "vitest";
import { MICRORUB_PER_RUB } from "@vimla/billing";
import { VIMLA_AI_MODEL_CATALOG } from "./catalog.js";

describe("VIMLA_AI_MODEL_CATALOG", () => {
  it("tracks Gemini cache-read pricing as a billable dimension", () => {
    const gemini = VIMLA_AI_MODEL_CATALOG.find(
      (model) => model.slug === "gemini-3-5-flash-lite",
    );
    expect(gemini).toBeDefined();
    expect(gemini?.inputMicroRubPerMillion).toBe(91n * MICRORUB_PER_RUB);
    expect(gemini?.outputMicroRubPerMillion).toBe(758n * MICRORUB_PER_RUB);
    expect(gemini?.cacheReadMicroRubPerMillion).toBe(9n * MICRORUB_PER_RUB);
  });
});
