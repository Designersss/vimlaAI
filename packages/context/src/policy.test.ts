import { describe, expect, it } from "vitest";
import {
  evaluateContextPolicy,
  evaluateContextWritePolicy,
  type ContextSurfaceDescriptor,
} from "./policy.js";

describe("ContextPolicy", () => {
  it("keeps private personal context out of a Direct Chat audience", () => {
    const decision = evaluateContextPolicy({
      actorUserId: "nikita",
      surface: {
        kind: "DIRECT_CHAT",
        directConversationId: "direct-1",
      },
      targetKind: "VIMLA",
      classification: "PRIVATE",
      sourceScope: {
        kind: "PERSONAL",
        ownerUserId: "nikita",
      },
      actorHasAccess: true,
      audienceHasAccess: false,
    });

    expect(decision).toEqual({
      allowed: false,
      reason: "SOURCE_SCOPE_DENIED",
    });
  });

  it("allows project context in a Direct Chat only after audience access passes", () => {
    const base = {
      actorUserId: "nikita",
      surface: {
        kind: "DIRECT_CHAT",
        directConversationId: "direct-1",
      } satisfies ContextSurfaceDescriptor,
      targetKind: "AI_MODEL" as const,
      classification: "PRIVATE" as const,
      sourceScope: {
        kind: "PROJECT" as const,
        projectId: "project-x",
      },
      actorHasAccess: true,
    };

    expect(
      evaluateContextPolicy({
        ...base,
        audienceHasAccess: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "AUDIENCE_ACCESS_DENIED",
    });

    expect(
      evaluateContextPolicy({
        ...base,
        audienceHasAccess: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("isolates project surfaces from unrelated projects and personal context", () => {
    const surface = {
      kind: "PROJECT",
      projectId: "project-a",
    } satisfies ContextSurfaceDescriptor;

    expect(
      evaluateContextPolicy({
        actorUserId: "user-1",
        surface,
        targetKind: "VIMLA",
        classification: "PRIVATE",
        sourceScope: { kind: "PROJECT", projectId: "project-b" },
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "SOURCE_SCOPE_DENIED",
    });

    expect(
      evaluateContextPolicy({
        actorUserId: "user-1",
        surface,
        targetKind: "VIMLA",
        classification: "PRIVATE",
        sourceScope: { kind: "PERSONAL", ownerUserId: "user-1" },
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "SOURCE_SCOPE_DENIED",
    });
  });

  it("allows an authorized project read from a private personal surface", () => {
    expect(
      evaluateContextPolicy({
        actorUserId: "user-1",
        surface: { kind: "PERSONAL", ownerUserId: "user-1" },
        targetKind: "AI_MODEL",
        classification: "PRIVATE",
        sourceScope: { kind: "PROJECT", projectId: "project-x" },
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("blocks restricted context from external targets", () => {
    expect(
      evaluateContextPolicy({
        actorUserId: "user-1",
        surface: { kind: "PERSONAL", ownerUserId: "user-1" },
        targetKind: "AI_MODEL",
        classification: "RESTRICTED",
        sourceScope: { kind: "PERSONAL", ownerUserId: "user-1" },
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "TARGET_CLASSIFICATION_DENIED",
    });

    expect(
      evaluateContextPolicy({
        actorUserId: "user-1",
        surface: { kind: "PERSONAL", ownerUserId: "user-1" },
        targetKind: "VIMLA",
        classification: "RESTRICTED",
        sourceScope: { kind: "PERSONAL", ownerUserId: "user-1" },
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("requires an explicit action for cross-scope project writes", () => {
    const base = {
      actorUserId: "user-1",
      surface: {
        kind: "PERSONAL",
        ownerUserId: "user-1",
      } satisfies ContextSurfaceDescriptor,
      requestedScope: {
        kind: "PROJECT" as const,
        projectId: "project-x",
      },
      actorHasWriteAccess: true,
    };

    expect(
      evaluateContextWritePolicy({
        ...base,
        explicitAction: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
    });

    expect(
      evaluateContextWritePolicy({
        ...base,
        explicitAction: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("does not let a project surface write a different project", () => {
    expect(
      evaluateContextWritePolicy({
        actorUserId: "user-1",
        surface: { kind: "PROJECT", projectId: "project-a" },
        requestedScope: { kind: "PROJECT", projectId: "project-b" },
        explicitAction: true,
        actorHasWriteAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "WRITE_SCOPE_DENIED",
    });
  });
});
