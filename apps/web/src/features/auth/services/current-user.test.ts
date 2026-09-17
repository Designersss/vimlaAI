import { describe, expect, it, vi } from "vitest";
import { AuthRequiredError, fetchCurrentUser } from "./current-user";

describe("fetchCurrentUser", () => {
  it("parses the current user contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          id: "user_1",
          email: "ada@example.com",
          name: "Ada",
          image: null,
          emailVerified: true,
          handle: "ada",
          handleStatus: "ACTIVE",
          handleRequired: false,
          locale: "ru",
          timezone: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const user = await fetchCurrentUser(fetchImpl);
    expect(user.email).toBe("ada@example.com");
    expect(user.handle).toBe("ada");
    expect(user.handleStatus).toBe("ACTIVE");
    expect(user.handleRequired).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3001/v1/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("treats 401 as an auth required error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Authentication required" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });

    await expect(fetchCurrentUser(fetchImpl)).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
  });
});
