import { describe, expect, it } from "vitest";
import { createNativeHttpTransport } from "./http-transport.js";
import { ProxyApiProvider } from "./proxyapi-provider.js";

const live = process.env.VIMLA_PROXYAPI_LIVE === "1";

describe.skipIf(!live)("optional ProxyAPI smoke", () => {
  it("sends at most one tiny request when explicitly enabled", async () => {
    const key = process.env.PROXYAPI_API_KEY;
    if (!key) {
      throw new Error("PROXYAPI_API_KEY is required for VIMLA_PROXYAPI_LIVE=1");
    }

    const provider = new ProxyApiProvider(
      key,
      "https://api.proxyapi.ru/v1",
      30_000,
      createNativeHttpTransport(),
    );
    const session = await provider.streamChat({
      providerModelId: "openai/gpt-5.6-luna",
      messages: [{ role: "user", content: "Reply with one word: ok" }],
      maxOutputTokens: 32,
      correlationId: "vimla-live-smoke",
    });

    let text = "";
    for await (const event of session.events) {
      if (event.type === "delta") {
        text += event.text;
      }
    }

    expect(text.length).toBeGreaterThan(0);
    expect(JSON.stringify(session)).not.toContain(key);
  });
});
