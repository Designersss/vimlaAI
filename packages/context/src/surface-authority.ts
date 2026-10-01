import type {
  CommunicationSurfaceKind,
} from "@vimla/contracts";
import type {
  ContextReadScope,
  ContextWriteScope,
} from "./policy.js";

export type SurfaceCapability =
  | "CONTEXT_READ"
  | "CONTEXT_CONTRIBUTE"
  | "AI_INVOKE"
  | "ACTION_INVOKE";

export interface SurfaceDisclosurePolicy {
  serverPlaintextAvailable: boolean;
  clientDisclosureRequired: boolean;
  peerContentRequiresConsent: boolean;
}

export type SurfaceReadScopeRule =
  | { kind: "PERSONAL"; ownerUserId: string }
  | {
      kind: "PROJECT";
      projectId: string | "ANY_AUTHORIZED";
    }
  | {
      kind: "DIRECT_CHAT";
      directConversationId: string;
    };

export type SurfaceWriteScopeRule =
  | {
      kind: "PERSONAL";
      ownerUserId: string;
      explicitActionRequired: false;
    }
  | {
      kind: "PROJECT";
      projectId: string | "ANY_AUTHORIZED";
      explicitActionRequired: true;
    }
  | {
      kind: "DIRECT_CHAT";
      directConversationId: string;
      explicitActionRequired: false;
    };

export interface ResolvedSurfaceAuthority {
  surfaceId: string;
  kind: CommunicationSurfaceKind;
  domainId: string;
  actorUserId: string;
  canRead: boolean;
  canContribute: boolean;
  audienceUserIds: readonly string[];
  eligibleReadScopes: readonly SurfaceReadScopeRule[];
  eligibleWriteScopes: readonly SurfaceWriteScopeRule[];
  disclosurePolicy: SurfaceDisclosurePolicy;
  capabilities: readonly SurfaceCapability[];
}

export interface ResolveSurfaceAuthorityInput {
  actorUserId: string;
  surfaceId: string;
}

export interface SurfaceIdentity {
  surfaceId: string;
  kind: CommunicationSurfaceKind;
}

export interface SurfaceIdentityResolver {
  resolve(
    surfaceId: string,
  ): Promise<SurfaceIdentity | null>;
}

export interface SurfaceAuthorityAdapter {
  readonly kind: CommunicationSurfaceKind;
  resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<ResolvedSurfaceAuthority | null>;
}

export class SurfaceAuthorityRegistry {
  private readonly adapters =
    new Map<
      CommunicationSurfaceKind,
      SurfaceAuthorityAdapter
    >();

  constructor(
    private readonly identities: SurfaceIdentityResolver,
    adapters: readonly SurfaceAuthorityAdapter[],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) {
        throw new Error(
          `Duplicate surface authority adapter for ${adapter.kind}`,
        );
      }
      this.adapters.set(adapter.kind, adapter);
    }
  }

  async resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<ResolvedSurfaceAuthority> {
    const identity =
      await this.identities.resolve(input.surfaceId);
    if (!identity) {
      throw new SurfaceIdentityUnavailableError(
        input.surfaceId,
      );
    }

    const adapter = this.adapters.get(identity.kind);
    if (!adapter) {
      throw new SurfaceAuthorityUnavailableError(
        identity.kind,
      );
    }

    const authority = await adapter.resolve(input);
    if (
      !authority ||
      authority.surfaceId !== identity.surfaceId ||
      authority.kind !== identity.kind ||
      authority.actorUserId !== input.actorUserId
    ) {
      throw new SurfaceAccessDeniedError(
        input.surfaceId,
      );
    }
    return authority;
  }
}

export function isReadScopeEligible(
  authority: ResolvedSurfaceAuthority,
  scope: ContextReadScope,
): boolean {
  return authority.eligibleReadScopes.some((rule) =>
    readRuleMatches(rule, scope),
  );
}

// This is the surface-level eligibility boundary only. A caller that performs
// a domain mutation must still obtain the domain's current write authority
// (for example ProjectService capabilities) before applying the action.
export function writeScopeRequirement(
  authority: ResolvedSurfaceAuthority,
  scope: ContextWriteScope,
): {
  eligible: boolean;
  explicitActionRequired: boolean;
} {
  const rule = authority.eligibleWriteScopes.find(
    (candidate) => writeRuleMatches(candidate, scope),
  );
  return rule
    ? {
        eligible: true,
        explicitActionRequired:
          rule.explicitActionRequired,
      }
    : {
        eligible: false,
        explicitActionRequired: false,
      };
}

function readRuleMatches(
  rule: SurfaceReadScopeRule,
  scope: ContextReadScope,
): boolean {
  if (rule.kind !== scope.kind) return false;
  if (
    rule.kind === "PERSONAL" &&
    scope.kind === "PERSONAL"
  ) {
    return rule.ownerUserId === scope.ownerUserId;
  }
  if (
    rule.kind === "PROJECT" &&
    scope.kind === "PROJECT"
  ) {
    return (
      rule.projectId === "ANY_AUTHORIZED" ||
      rule.projectId === scope.projectId
    );
  }
  return (
    rule.kind === "DIRECT_CHAT" &&
    scope.kind === "DIRECT_CHAT" &&
    rule.directConversationId ===
      scope.directConversationId
  );
}

function writeRuleMatches(
  rule: SurfaceWriteScopeRule,
  scope: ContextWriteScope,
): boolean {
  return readRuleMatches(rule, scope);
}

export class SurfaceIdentityUnavailableError extends Error {
  constructor(readonly surfaceId: string) {
    super(
      `Communication surface identity is unavailable for ${surfaceId}`,
    );
    this.name = "SurfaceIdentityUnavailableError";
  }
}

export class SurfaceAuthorityUnavailableError extends Error {
  constructor(
    readonly kind: CommunicationSurfaceKind,
  ) {
    super(
      `Surface authority adapter is unavailable for ${kind}`,
    );
    this.name = "SurfaceAuthorityUnavailableError";
  }
}

export class SurfaceAccessDeniedError extends Error {
  constructor(readonly surfaceId: string) {
    super(
      `Communication surface access is unavailable for ${surfaceId}`,
    );
    this.name = "SurfaceAccessDeniedError";
  }
}
