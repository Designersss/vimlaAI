import { describe, expect, it } from "vitest";
import {
  acceptProjectInviteSchema,
  createProjectInviteSchema,
  createProjectSchema,
  projectRoleUpdateSchema,
  updateProjectSchema,
} from "./projects.js";

describe("project public DTOs", () => {
  it("rejects owner, plan and lastOpenedAt injection on create", () => {
    expect(
      createProjectSchema.safeParse({
        name: "Alpha",
        userId: "other",
        ownerUserId: "other",
        lastOpenedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects empty patches and authority fields on update", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(
      updateProjectSchema.safeParse({
        name: "Beta",
        ownerUserId: "other",
      }).success,
    ).toBe(false);
  });

  it("rejects OWNER invites and extra authority fields", () => {
    expect(
      createProjectInviteSchema.safeParse({
        email: "member@example.com",
        role: "OWNER",
      }).success,
    ).toBe(false);
    expect(
      createProjectInviteSchema.safeParse({
        email: "member@example.com",
        role: "MEMBER",
        userId: "injected",
      }).success,
    ).toBe(false);
  });

  it("rejects OWNER role updates from clients", () => {
    expect(projectRoleUpdateSchema.safeParse({ role: "OWNER" }).success).toBe(false);
    expect(
      acceptProjectInviteSchema.safeParse({
        token: "token-token-token-token",
        userId: "other",
      }).success,
    ).toBe(false);
  });
});
