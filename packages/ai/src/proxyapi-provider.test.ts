import { describe, expect, it } from "vitest";
import { ProxyApiProvider } from "./proxyapi-provider.js";
import { ProviderCallError, type HttpFetch } from "./types.js";

const SECRET = "sk-test-proxyapi-secret-value";

describe("ProxyApiProvider", () => {
  it("posts to the configured chat completions path with a full model id", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    const fetchImpl: HttpFetch = async (url, init) => {
      seenUrl = url;
      seenAuth = JSON.stringify(init.headers ?? {});
      seenBody = String(init.body ?? "");
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "X-Request-ID": "prov-1" },
      });
    };

    const provider = new ProxyApiProvider(SECRET, "https://api.proxyapi.ru/v1", 5_000, fetchImpl);
    const result = await provider.streamChat({
      providerModelId: "openai/gpt-5.6-luna",
      messages: [{ role: "user", content: "Hi" }],
      maxOutputTokens: 32,
      correlationId: "corr-1",
    });
    for await (const event of result.events) {
      expect(["delta", "usage", "done"]).toContain(event.type);
    }

    expect(seenUrl).toBe("https://api.proxyapi.ru/v1/chat/completions");
    expect(seenAuth).toContain(`Bearer ${SECRET}`);
    expect(seenBody).toContain("openai/gpt-5.6-luna");
    expect(seenBody).toContain("max_completion_tokens");
    expect(result.providerRequestId).toBe("prov-1");
  });

  it("does not put the API key into thrown errors", async () => {
    const fetchImpl: HttpFetch = async () =>
      new Response(JSON.stringify({ error: SECRET }), { status: 401 });
    const provider = new ProxyApiProvider(SECRET, "https://api.proxyapi.ru/v1", 5_000, fetchImpl);

    await expect(
      provider.streamChat({
        providerModelId: "openai/gpt-5.6-luna",
        messages: [{ role: "user", content: "Hi" }],
        maxOutputTokens: 32,
        correlationId: "corr-2",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderCallError);
      if (!(error instanceof Error)) {
        return false;
      }
      return !error.message.includes(SECRET) && !error.stack?.includes(SECRET);
    });
  });

  it("treats 402 as a corporate balance failure, not user insufficient usage", async () => {
    const fetchImpl: HttpFetch = async () => new Response("{}", { status: 402 });
    const provider = new ProxyApiProvider(SECRET, "https://api.proxyapi.ru/v1", 5_000, fetchImpl);
    await expect(
      provider.streamChat({
        providerModelId: "openai/gpt-5.6-luna",
        messages: [{ role: "user", content: "Hi" }],
        maxOutputTokens: 32,
        correlationId: "corr-3",
      }),
    ).rejects.toMatchObject({ kind: "balance" });
  });
});
