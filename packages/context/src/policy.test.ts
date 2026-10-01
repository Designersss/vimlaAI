import { describe, expect, it } from "vitest";
import {
  evaluateContextPolicy,
  evaluateContextWritePolicy,
  isExternalProviderClassificationAllowed,
  isInvocationTargetClassificationAllowed,
} from "./policy.js";

describe("ContextPolicy", () => {
  it("fails closed before source access when the surface adapter rejects a scope", () => {
    expect(
      evaluateContextPolicy({
        targetKind: "VIMLA",
        classification: "PRIVATE",
        sourceScopeEligible: false,
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "SOURCE_SCOPE_DENIED",
    });
  });

  it("requires both actor and current audience access", () => {
    expect(
      evaluateContextPolicy({
        targetKind: "AI_MODEL",
        classification: "PRIVATE",
        sourceScopeEligible: true,
        actorHasAccess: false,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "ACTOR_ACCESS_DENIED",
    });

    expect(
      evaluateContextPolicy({
        targetKind: "AI_MODEL",
        classification: "PRIVATE",
        sourceScopeEligible: true,
        actorHasAccess: true,
        audienceHasAccess: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "AUDIENCE_ACCESS_DENIED",
    });
  });

  it("blocks restricted context from external targets", () => {
    expect(
      evaluateContextPolicy({
        targetKind: "AI_MODEL",
        classification: "RESTRICTED",
        sourceScopeEligible: true,
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "TARGET_CLASSIFICATION_DENIED",
    });

    expect(
      evaluateContextPolicy({
        targetKind: "VIMLA",
        classification: "RESTRICTED",
        sourceScopeEligible: true,
        actorHasAccess: true,
        audienceHasAccess: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("keeps external-provider classification checks fail-closed", () => {
    expect(isExternalProviderClassificationAllowed("PUBLIC")).toBe(true);
    expect(isExternalProviderClassificationAllowed("INTERNAL")).toBe(true);
    expect(isExternalProviderClassificationAllowed("PRIVATE")).toBe(true);
    expect(isExternalProviderClassificationAllowed("RESTRICTED")).toBe(false);
    expect(isExternalProviderClassificationAllowed("UNKNOWN")).toBe(false);
    expect(
      isInvocationTargetClassificationAllowed("EVALUATOR", "RESTRICTED"),
    ).toBe(true);
  });

  it("requires explicit action only when the selected domain rule requires it", () => {
    expect(
      evaluateContextWritePolicy({
        scopeEligible: true,
        explicitActionRequired: true,
        explicitAction: false,
        actorHasWriteAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
    });

    expect(
      evaluateContextWritePolicy({
        scopeEligible: true,
        explicitActionRequired: true,
        explicitAction: true,
        actorHasWriteAccess: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("fails closed when write authority or scope eligibility is missing", () => {
    expect(
      evaluateContextWritePolicy({
        scopeEligible: true,
        explicitActionRequired: false,
        explicitAction: false,
        actorHasWriteAccess: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "WRITE_ACCESS_DENIED",
    });
    expect(
      evaluateContextWritePolicy({
        scopeEligible: false,
        explicitActionRequired: false,
        explicitAction: true,
        actorHasWriteAccess: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "WRITE_SCOPE_DENIED",
    });
  });
});
