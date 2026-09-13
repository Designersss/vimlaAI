import { describe, expect, it } from "vitest";
import { createWebSecurityHeaders } from "./security-headers.js";

describe("createWebSecurityHeaders", () => {
  it.each(["staging", "production"])("enforces production-like headers for %s", (appEnv) => {
    const headers = Object.fromEntries(createWebSecurityHeaders({ appEnv, apiOrigin: "https://api.vimla.test/v1" }).map((h) => [h.key, h.value]));
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self' https://api.vimla.test");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toContain("publickey-credentials-get=(self)");
  });

  it("does not send HSTS in local development", () => {
    expect(createWebSecurityHeaders({ appEnv: "development" }).some((header) => header.key === "Strict-Transport-Security")).toBe(false);
  });

  it("keeps the Next development runtime usable without emitting HSTS", () => {
    const headers = Object.fromEntries(createWebSecurityHeaders({ appEnv: "test" }).map((h) => [h.key, h.value]));
    expect(headers["Content-Security-Policy"]).toContain("unsafe-eval");
    expect(headers["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });
});
