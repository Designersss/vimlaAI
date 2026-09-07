import { MICRORUB_PER_RUB, type MicroRub } from "@vimla/billing";

export interface CuratedModelSeed {
  slug: string;
  displayName: string;
  vendor: string;
  provider: "proxyapi";
  providerModelId: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  inputMicroRubPerMillion: MicroRub;
  outputMicroRubPerMillion: MicroRub;
  cacheReadMicroRubPerMillion: MicroRub | null;
  cacheWriteMicroRubPerMillion: MicroRub | null;
  verifiedAt: Date;
  source: string;
}

const PRICE_VERIFIED_AT = new Date("2026-09-07T00:00:00.000Z");
const PRICE_SOURCE = "proxyapi-manual-2026-09-07";

function price(rubPerMillion: bigint): MicroRub {
  return rubPerMillion * MICRORUB_PER_RUB;
}

export const VIMLA_AI_MODEL_CATALOG: readonly CuratedModelSeed[] = [
  {
    slug: "gpt-5-6-luna",
    displayName: "GPT-5.6 Luna",
    vendor: "openai",
    provider: "proxyapi",
    providerModelId: "openai/gpt-5.6-luna",
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    inputMicroRubPerMillion: price(60n),
    outputMicroRubPerMillion: price(360n),
    cacheReadMicroRubPerMillion: price(6n),
    cacheWriteMicroRubPerMillion: price(75n),
    verifiedAt: PRICE_VERIFIED_AT,
    source: PRICE_SOURCE,
  },
  {
    slug: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    vendor: "anthropic",
    provider: "proxyapi",
    providerModelId: "anthropic/claude-haiku-4-5",
    contextWindowTokens: 200_000,
    maxOutputTokens: 16_384,
    inputMicroRubPerMillion: price(295n),
    outputMicroRubPerMillion: price(1474n),
    cacheReadMicroRubPerMillion: price(30n),
    cacheWriteMicroRubPerMillion: price(369n),
    verifiedAt: PRICE_VERIFIED_AT,
    source: PRICE_SOURCE,
  },
  {
    slug: "gemini-3-5-flash-lite",
    displayName: "Gemini 3.5 Flash Lite",
    vendor: "google",
    provider: "proxyapi",
    providerModelId: "google/gemini-3.5-flash-lite",
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    inputMicroRubPerMillion: price(91n),
    outputMicroRubPerMillion: price(758n),
    cacheReadMicroRubPerMillion: null,
    cacheWriteMicroRubPerMillion: null,
    verifiedAt: PRICE_VERIFIED_AT,
    source: PRICE_SOURCE,
  },
];

export const AI_PRICE_VERIFIED_AT = PRICE_VERIFIED_AT;
