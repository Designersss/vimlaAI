import { describe, expect, it, vi } from "vitest";
import { fetchApiHealth } from "./health";

describe("fetchApiHealth", () => {
  it("validates the health contract from the API payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "api",
          checks: {
            api: { status: "ok" },
            database: { status: "ok" },
            redis: { status: "ok" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await fetchApiHealth("http://localhost:3001", fetchImpl);
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3001/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
