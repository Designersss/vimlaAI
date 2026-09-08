import { describe, expect, it } from "vitest";
import { hasPermission, OWNER_PERMISSIONS } from "./permissions.js";
import { sanitizeAuditSnapshot } from "./security.js";

describe("admin permissions", () => {
  it("gives OWNER every declared permission", () => {
    expect(hasPermission(OWNER_PERMISSIONS, "finance.read")).toBe(true);
    expect(hasPermission(OWNER_PERMISSIONS, "admin.manage")).toBe(true);
    expect(hasPermission(["finance.read"], "tariffs.manage")).toBe(false);
  });
});

describe("audit sanitizer", () => {
  it("redacts secrets and never keeps TOTP or backup material", () => {
    const sanitized = sanitizeAuditSnapshot({
      totpSecret: "abc",
      backupCodes: ["one"],
      password: "x",
      TBANK_PASSWORD: "y",
      planCode: "T199",
    }) as Record<string, unknown>;
    expect(sanitized.totpSecret).toBe("[redacted]");
    expect(sanitized.backupCodes).toBe("[redacted]");
    expect(sanitized.password).toBe("[redacted]");
    expect(sanitized.TBANK_PASSWORD).toBe("[redacted]");
    expect(sanitized.planCode).toBe("T199");
  });
});
