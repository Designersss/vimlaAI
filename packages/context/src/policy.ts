import type { ContextClassification } from "./types.js";

export const CONTEXT_POLICY_VERSION = 1 as const;

export type ContextAudienceKind = "PERSONAL" | "PROJECT" | "DIRECT_CHAT";
export type ContextInvocationTargetKind =
  | "VIMLA"
  | "AI_AUTO"
  | "AI_MODEL"
  | "AGENT"
  | "EVALUATOR";

export type ContextSourceScope =
  | { kind: "PERSONAL"; ownerUserId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "DIRECT_CHAT"; directConversationId: string };

export type ContextReadScope = ContextSourceScope;
export type ContextWriteScope = ContextSourceScope;

export type ContextSurfaceDescriptor =
  | { kind: "PERSONAL"; ownerUserId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "DIRECT_CHAT"; directConversationId: string };

export type ContextReadScopeRule =
  | { kind: "PERSONAL"; selector: "ACTOR" }
  | { kind: "PROJECT"; selector: "CURRENT" | "ANY_AUTHORIZED" }
  | { kind: "DIRECT_CHAT"; selector: "CURRENT" };

export type ContextWriteScopeRule =
  | {
      kind: "PERSONAL";
      selector: "ACTOR";
      explicitActionRequired: false;
    }
  | {
      kind: "PROJECT";
      selector: "CURRENT" | "ANY_AUTHORIZED";
      explicitActionRequired: true;
    }
  | {
      kind: "DIRECT_CHAT";
      selector: "CURRENT";
      explicitActionRequired: false;
    };

export interface ContextSurfaceScopePolicy {
  readScope: readonly ContextReadScopeRule[];
  writeScope: readonly ContextWriteScopeRule[];
}

export function contextSurfaceScopePolicy(
  surface: ContextSurfaceDescriptor,
): ContextSurfaceScopePolicy {
  switch (surface.kind) {
    case "PERSONAL":
      return {
        readScope: [
          { kind: "PERSONAL", selector: "ACTOR" },
          { kind: "PROJECT", selector: "ANY_AUTHORIZED" },
        ],
        writeScope: [
          {
            kind: "PERSONAL",
            selector: "ACTOR",
            explicitActionRequired: false,
          },
          {
            kind: "PROJECT",
            selector: "ANY_AUTHORIZED",
            explicitActionRequired: true,
          },
        ],
      };

    case "PROJECT":
      return {
        readScope: [{ kind: "PROJECT", selector: "CURRENT" }],
        writeScope: [
          {
            kind: "PROJECT",
            selector: "CURRENT",
            explicitActionRequired: true,
          },
        ],
      };

    case "DIRECT_CHAT":
      return {
        readScope: [
          { kind: "DIRECT_CHAT", selector: "CURRENT" },
          { kind: "PROJECT", selector: "ANY_AUTHORIZED" },
        ],
        writeScope: [
          {
            kind: "DIRECT_CHAT",
            selector: "CURRENT",
            explicitActionRequired: false,
          },
        ],
      };
  }
}

export type ContextAudienceDescriptor =
  | {
      kind: "PERSONAL";
      participantUserIds: readonly string[];
    }
  | {
      kind: "PROJECT";
      participantUserIds: readonly string[];
      projectId: string;
    }
  | {
      kind: "DIRECT_CHAT";
      participantUserIds: readonly string[];
      directConversationId: string;
    };

export type ContextPolicyDenialReason =
  | "SOURCE_SCOPE_DENIED"
  | "TARGET_CLASSIFICATION_DENIED"
  | "ACTOR_ACCESS_DENIED"
  | "AUDIENCE_ACCESS_DENIED";

export type ContextPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: ContextPolicyDenialReason };

export interface EvaluateContextPolicyInput {
  actorUserId: string;
  surface: ContextSurfaceDescriptor;
  targetKind: ContextInvocationTargetKind;
  classification: ContextClassification;
  sourceScope: ContextReadScope;
  actorHasAccess: boolean;
  audienceHasAccess: boolean;
}

export function evaluateContextPolicy(
  input: EvaluateContextPolicyInput,
): ContextPolicyDecision {
  if (!sourceScopeAllowed(input.surface, input.sourceScope, input.actorUserId)) {
    return { allowed: false, reason: "SOURCE_SCOPE_DENIED" };
  }

  if (
    isExternalTarget(input.targetKind) &&
    !isExternalProviderClassificationAllowed(input.classification)
  ) {
    return { allowed: false, reason: "TARGET_CLASSIFICATION_DENIED" };
  }

  if (!input.actorHasAccess) {
    return { allowed: false, reason: "ACTOR_ACCESS_DENIED" };
  }

  if (!input.audienceHasAccess) {
    return { allowed: false, reason: "AUDIENCE_ACCESS_DENIED" };
  }

  return { allowed: true };
}

export type ContextWriteDenialReason =
  | "WRITE_SCOPE_DENIED"
  | "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION"
  | "WRITE_ACCESS_DENIED";

export type ContextWriteDecision =
  | { allowed: true }
  | { allowed: false; reason: ContextWriteDenialReason };

export interface EvaluateContextWritePolicyInput {
  actorUserId: string;
  surface: ContextSurfaceDescriptor;
  requestedScope: ContextWriteScope;
  explicitAction: boolean;
  actorHasWriteAccess: boolean;
}

export function evaluateContextWritePolicy(
  input: EvaluateContextWritePolicyInput,
): ContextWriteDecision {
  if (!input.actorHasWriteAccess) {
    return { allowed: false, reason: "WRITE_ACCESS_DENIED" };
  }

  const rule = contextSurfaceScopePolicy(input.surface).writeScope.find(
    (candidate) =>
      writeScopeRuleMatches(
        candidate,
        input.surface,
        input.requestedScope,
        input.actorUserId,
      ),
  );
  if (!rule) {
    return { allowed: false, reason: "WRITE_SCOPE_DENIED" };
  }

  if (rule.explicitActionRequired && !input.explicitAction) {
    return {
      allowed: false,
      reason: "CROSS_SCOPE_WRITE_REQUIRES_EXPLICIT_ACTION",
    };
  }

  return { allowed: true };
}

export function surfaceFromAudience(
  actorUserId: string,
  audience: ContextAudienceDescriptor,
): ContextSurfaceDescriptor {
  switch (audience.kind) {
    case "PERSONAL":
      return { kind: "PERSONAL", ownerUserId: actorUserId };
    case "PROJECT":
      return { kind: "PROJECT", projectId: audience.projectId };
    case "DIRECT_CHAT":
      return {
        kind: "DIRECT_CHAT",
        directConversationId: audience.directConversationId,
      };
  }
}

function sourceScopeAllowed(
  surface: ContextSurfaceDescriptor,
  source: ContextReadScope,
  actorUserId: string,
): boolean {
  return contextSurfaceScopePolicy(surface).readScope.some((rule) =>
    readScopeRuleMatches(rule, surface, source, actorUserId),
  );
}

function readScopeRuleMatches(
  rule: ContextReadScopeRule,
  surface: ContextSurfaceDescriptor,
  source: ContextReadScope,
  actorUserId: string,
): boolean {
  if (rule.kind !== source.kind) return false;

  switch (rule.kind) {
    case "PERSONAL":
      return (
        source.kind === "PERSONAL" &&
        surface.kind === "PERSONAL" &&
        surface.ownerUserId === actorUserId &&
        source.ownerUserId === actorUserId
      );

    case "PROJECT":
      if (source.kind !== "PROJECT") return false;
      return (
        rule.selector === "ANY_AUTHORIZED" ||
        (surface.kind === "PROJECT" && source.projectId === surface.projectId)
      );

    case "DIRECT_CHAT":
      return (
        source.kind === "DIRECT_CHAT" &&
        surface.kind === "DIRECT_CHAT" &&
        source.directConversationId === surface.directConversationId
      );
  }
}

function writeScopeRuleMatches(
  rule: ContextWriteScopeRule,
  surface: ContextSurfaceDescriptor,
  requested: ContextWriteScope,
  actorUserId: string,
): boolean {
  if (rule.kind !== requested.kind) return false;

  switch (rule.kind) {
    case "PERSONAL":
      return (
        requested.kind === "PERSONAL" &&
        surface.kind === "PERSONAL" &&
        surface.ownerUserId === actorUserId &&
        requested.ownerUserId === actorUserId
      );

    case "PROJECT":
      if (requested.kind !== "PROJECT") return false;
      return (
        rule.selector === "ANY_AUTHORIZED" ||
        (surface.kind === "PROJECT" &&
          requested.projectId === surface.projectId)
      );

    case "DIRECT_CHAT":
      return (
        requested.kind === "DIRECT_CHAT" &&
        surface.kind === "DIRECT_CHAT" &&
        requested.directConversationId === surface.directConversationId
      );
  }
}

export function isExternalProviderClassificationAllowed(
  classification: string,
): boolean {
  return (
    classification === "PUBLIC" ||
    classification === "INTERNAL" ||
    classification === "PRIVATE"
  );
}

function isExternalTarget(target: ContextInvocationTargetKind): boolean {
  return target === "AI_AUTO" || target === "AI_MODEL" || target === "AGENT";
}
