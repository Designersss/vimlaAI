import { describe, expect, it, vi } from "vitest";
import { currentUserSchema } from "@vimla/contracts";
import { AuthRequiredError, createClientTransport } from "./transport.js";
import type { ClientApiError } from "./transport.js";

function response(
  status: number,
  payload: unknown,
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  } as Response;
}

describe("client transport", () => {
  it("injects base URL/default session init and parses a typed response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response(200, {
        id: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        name: "User",
        image: null,
        emailVerified: true,
        handle: "user",
        handleStatus: "ACTIVE",
        handleRequired: false,
        locale: "en",
        timezone: "UTC",
      }),
    );
    const transport = createClientTransport({
      baseUrl: "https://api.example.test/",
      fetchImpl,
      defaultInit: {
        credentials: "include",
        cache: "no-store",
      },
    });
    const result = await transport.request("/v1/me", {
      parse: (payload) => currentUserSchema.parse(payload),
    });
    expect(result.email).toBe("user@example.com");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/me",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
      }),
    );
  });

  it("maps 401 to AuthRequiredError", async () => {
    const transport = createClientTransport({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response(401, null),
      ),
    });
    await expect(
      transport.request("/v1/me", { parse: (payload) => payload }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("uses the stable API error envelope without leaking arbitrary payloads", async () => {
    const transport = createClientTransport({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response(409, {
          error: {
            code: "conflict",
            message: "Conflict",
          },
        }),
      ),
    });
    await expect(
      transport.request("/v1/test", { parse: (payload) => payload }),
    ).rejects.toMatchObject<ClientApiError>({
      code: "conflict",
      status: 409,
    });
  });
});
