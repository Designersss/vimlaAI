import { describe, expect, it } from "vitest";
import {
  clientInstallationViewSchema,
  preferenceScopeSchema,
  registerClientInstallationSchema,
  updateClientInstallationPreferencesSchema,
} from "./client-installations.js";

describe("client installation contracts", () => {
  it("keeps preference scopes explicit", () => {
    expect(preferenceScopeSchema.options).toEqual([
      "ACCOUNT",
      "INSTALLATION",
      "SURFACE",
    ]);
  });

  it("rejects authority and ownership fields from registration", () => {
    expect(
      registerClientInstallationSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "WEB",
        appVersion: "1.0.0",
        protocolVersion: 1,
        capabilities: ["realtime.v1"],
        userId: "other-user",
        role: "ADMIN",
      }).success,
    ).toBe(false);
  });

  it("rejects the nil UUID installation identity", () => {
    expect(
      registerClientInstallationSchema.safeParse({
        id: "00000000-0000-0000-0000-000000000000",
        kind: "WEB",
        appVersion: null,
        protocolVersion: 1,
        capabilities: [],
      }).success,
    ).toBe(false);
  });

  it("normalizes capabilities and rejects duplicates", () => {
    const parsed = registerClientInstallationSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "WEB",
      appVersion: null,
      protocolVersion: 1,
      capabilities: ["sync.v1", "realtime.v1"],
    });
    expect(parsed.capabilities).toEqual(["realtime.v1", "sync.v1"]);
    expect(
      registerClientInstallationSchema.safeParse({
        ...parsed,
        capabilities: ["sync.v1", "sync.v1"],
      }).success,
    ).toBe(false);
  });

  it("counts appVersion length by Unicode code points like PostgreSQL", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "WEB",
      protocolVersion: 1,
      capabilities: [],
    };
    expect(
      registerClientInstallationSchema.safeParse({
        ...base,
        appVersion: "😀".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      registerClientInstallationSchema.safeParse({
        ...base,
        appVersion: "😀".repeat(65),
      }).success,
    ).toBe(false);
    expect(
      registerClientInstallationSchema.safeParse({
        ...base,
        appVersion: "\ud800",
      }).success,
    ).toBe(false);
  });

  it("rejects empty installation preference patches", () => {
    expect(
      updateClientInstallationPreferencesSchema.safeParse({}).success,
    ).toBe(false);
  });

  it("applies registration metadata bounds to public views too", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "WEB",
      appVersion: "1.0.0",
      protocolVersion: 1,
      capabilities: ["realtime.v1"],
      createdAt: "2026-09-29T12:00:00.000Z",
      lastSeenAt: "2026-09-29T12:00:00.000Z",
      revokedAt: null,
      preferences: { pushEnabled: false },
    };
    expect(
      clientInstallationViewSchema.safeParse({
        ...base,
        appVersion: "x".repeat(65),
      }).success,
    ).toBe(false);
    expect(
      clientInstallationViewSchema.safeParse({
        ...base,
        protocolVersion: 1_000_001,
      }).success,
    ).toBe(false);
    expect(
      clientInstallationViewSchema.safeParse({
        ...base,
        capabilities: ["sync.v1", "sync.v1"],
      }).success,
    ).toBe(false);
  });

  it("does not expose user ownership in the public view", () => {
    const parsed = clientInstallationViewSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "WEB",
      appVersion: null,
      protocolVersion: 1,
      capabilities: [],
      createdAt: "2026-09-29T12:00:00.000Z",
      lastSeenAt: "2026-09-29T12:00:00.000Z",
      revokedAt: null,
      preferences: { pushEnabled: true },
    });
    expect("userId" in parsed).toBe(false);
  });
});
