import { createHash } from "node:crypto";
import {
  ArtifactError,
  ArtifactService,
  type ResolvedArtifactInput,
} from "@vimla/artifacts";
import type { CommunicationSurfaceKind } from "@vimla/contracts";
import { type Prisma, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextNotFoundError,
  ContextValidationError,
} from "./errors.js";
import {
  CONTEXT_PACKING_VERSION,
  ContextBudgetService,
  type ContextBudget,
} from "./budget.js";
import { canonicalJson } from "./fingerprint.js";
import {
  packContextItems,
  type ContextPackingExclusionReason,
} from "./packer.js";
import {
  CONTEXT_POLICY_VERSION,
  evaluateContextPolicy,
  isInvocationTargetClassificationAllowed,
  isKnownContextClassification,
  type ContextInvocationTargetKind,
  type ContextPolicyDenialReason,
  type ContextSourceScope,
} from "./policy.js";
import {
  isReadScopeEligible,
  SurfaceAccessDeniedError,
  SurfaceAuthorityUnavailableError,
  SurfaceIdentityUnavailableError,
  type ResolvedSurfaceAuthority,
  type SurfaceAuthorityRegistry,
  type SurfaceCapability,
  type SurfaceDisclosurePolicy,
} from "./surface-authority.js";
import { createSurfaceAuthorityRegistry } from "./surface-authority-db.js";
import {
  createContextScopeAuthorityRegistry,
  type ContextScopeAuthorityRegistry,
} from "./scope-authority.js";
import { ContextSnapshotService } from "./service.js";
import type {
  ContextClassification,
  ContextSnapshotItemView,
  ContextSourceType,
  ResolveInvocationContextInput,
} from "./types.js";

const MAX_AUDIENCE_PARTICIPANTS = 64;

interface ContextAudienceClaim {
  surfaceId: string;
  participantUserIds: readonly string[];
  focusedProjectId?: string;
}

export type ContextBundleDenialReason =
  | ContextPolicyDenialReason
  | "INVALID_AUDIENCE";

export interface ContextBundleDenialAudit {
  sourceType: ContextSourceType;
  sourceRefHash: string;
  classification: ContextClassification;
  reason: ContextBundleDenialReason;
}

export interface ContextBundlePackingExclusionAudit {
  sourceType: ContextSourceType;
  sourceRefHash: string;
  classification: ContextClassification;
  reason: ContextPackingExclusionReason;
}

export interface ContextBundleArtifactDenialAudit {
  artifactRefHash: string;
  classification: ContextClassification | "UNKNOWN";
  reason:
    | "TARGET_CLASSIFICATION_DENIED"
    | "ACTOR_ACCESS_DENIED"
    | "AUDIENCE_ACCESS_DENIED";
}

export interface ContextBundleManifest {
  version: typeof CONTEXT_POLICY_VERSION;
  packingVersion: typeof CONTEXT_PACKING_VERSION;
  targetKind: ContextInvocationTargetKind;
  surfaceKind: CommunicationSurfaceKind | "UNKNOWN";
  surfaceScopeHash: string;
  audienceParticipantCount: number;
  surfaceCapabilities: SurfaceCapability[];
  disclosurePolicy: SurfaceDisclosurePolicy;
  budget: ContextBudget;
  usedTokens: number;
  rawHistoryTokens: number;
  compactedStateRequired: boolean;
  allowedItems: Array<{
    snapshotItemId: string;
    sourceType: ContextSourceType;
    classification: ContextClassification;
    fingerprint: string;
    estimatedTokens: number;
    selectionReason:
      | "IMMEDIATE"
      | "CURRENT_SURFACE"
      | "CURRENT_PROJECT"
      | "DIRECT_REFERENCE"
      | "AUTHORITATIVE"
      | "RELEVANT"
      | "RECENT"
      | "FALLBACK";
  }>;
  allowedArtifacts: Array<{
    inputName: string;
    artifactId: string;
    artifactVersionId: string;
    classification: ContextClassification;
    version: number;
    fingerprint: string;
  }>;
  denials: ContextBundleDenialAudit[];
  packingExclusions: ContextBundlePackingExclusionAudit[];
  artifactDenials: ContextBundleArtifactDenialAudit[];
}

export interface ContextBundleView {
  id: string;
  invocationId: string;
  snapshotId: string;
  fingerprint: string;
  manifest: ContextBundleManifest;
  items: ContextSnapshotItemView[];
  artifacts: ResolvedArtifactInput[];
  createdAt: string;
}

export class ContextBundleService {
  private readonly snapshots: ContextSnapshotService;
  private readonly artifacts: ArtifactService;
  private readonly budgets: ContextBudgetService;
  private readonly surfaceAuthorities: SurfaceAuthorityRegistry;
  private readonly scopeAuthorities: ContextScopeAuthorityRegistry;

  constructor(
    private readonly db: PrismaClient,
    snapshotService?: ContextSnapshotService,
    artifactService?: ArtifactService,
    budgetService?: ContextBudgetService,
    surfaceAuthorityRegistry?: SurfaceAuthorityRegistry,
    scopeAuthorityRegistry?: ContextScopeAuthorityRegistry,
  ) {
    this.surfaceAuthorities =
      surfaceAuthorityRegistry ??
      createSurfaceAuthorityRegistry(db);
    this.scopeAuthorities =
      scopeAuthorityRegistry ??
      createContextScopeAuthorityRegistry(db);
    this.snapshots =
      snapshotService ??
      new ContextSnapshotService(
        db,
        undefined,
        undefined,
        this.surfaceAuthorities,
      );
    this.artifacts = artifactService ?? new ArtifactService(db);
    this.budgets = budgetService ?? new ContextBudgetService(db);
  }

  async resolveForInvocation(
    input: ResolveInvocationContextInput,
  ): Promise<ContextBundleView> {
    const invocation = await this.db.invocation.findFirst({
      where: {
        id: input.invocationId,
        plan: { userId: input.actorUserId },
      },
      select: {
        id: true,
        planId: true,
        targetKind: true,
        targetModelSlug: true,
        plan: {
          select: {
            conversation: {
              select: {
                id: true,
                kind: true,
                surface: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!invocation) {
      throw new ContextNotFoundError("Invocation not found");
    }

    const targetKind = parseTargetKind(invocation.targetKind);
    const snapshot = await this.snapshots.getByPlan(
      input.actorUserId,
      invocation.planId,
    );
    const audienceItem = singleAudienceItem(snapshot.items);
    const audience = parseAudience(
      input.actorUserId,
      audienceItem,
    );
    const authority = await this.resolveSurfaceAuthority(
      input.actorUserId,
      audience.surfaceId,
    );
    const planConversation = invocation.plan.conversation;
    const audienceMatchesPlanSurface =
      planConversation.kind === "CHAT" &&
      planConversation.surface?.id === audience.surfaceId &&
      authority?.kind === "AI_THREAD" &&
      authority.domainId === planConversation.id;

    const policyAllowedItems: ContextSnapshotItemView[] = [];
    const allowedArtifacts: ResolvedArtifactInput[] = [];
    const denials: ContextBundleDenialAudit[] = [];
    const artifactDenials: ContextBundleArtifactDenialAudit[] = [];
    let blockingDenial = false;

    if (
      !authority ||
      !audienceMatchesPlanSurface ||
      !authority.canRead ||
      !authority.capabilities.includes("CONTEXT_READ") ||
      !authoritySupportsInvocation(authority, targetKind) ||
      !sameAudience(
        audience.participantUserIds,
        authority.audienceUserIds,
      )
    ) {
      denials.push(
        denialFor(audienceItem, "INVALID_AUDIENCE"),
      );
      blockingDenial = true;
    } else {
      for (const item of snapshot.items) {
        if (item.sourceType === "AUDIENCE") continue;

        const sourceScope = inferSourceScope(input.actorUserId, item);
        const preflight = evaluateContextPolicy({
          targetKind,
          classification: item.classification,
          sourceScopeEligible: isReadScopeEligible(
            authority,
            sourceScope,
          ),
          actorHasAccess: true,
          audienceHasAccess: true,
        });
        if (!preflight.allowed) {
          denials.push(denialFor(item, preflight.reason));
          continue;
        }

        const actorHasAccess = await this.canReadSource(
          input.actorUserId,
          item,
        );
        const audienceHasAccess =
          actorHasAccess &&
          (await this.everyAudienceMemberCanReadScope(
            authority.audienceUserIds,
            sourceScope,
          )) &&
          (await this.everyAudienceMemberCanReadSource(
            authority.audienceUserIds,
            item,
            input.actorUserId,
          ));
        const decision = evaluateContextPolicy({
          targetKind,
          classification: item.classification,
          sourceScopeEligible: isReadScopeEligible(
            authority,
            sourceScope,
          ),
          actorHasAccess,
          audienceHasAccess,
        });

        if (decision.allowed) {
          policyAllowedItems.push(item);
          continue;
        }

        denials.push(denialFor(item, decision.reason));
        if (
          decision.reason === "ACTOR_ACCESS_DENIED" ||
          decision.reason === "AUDIENCE_ACCESS_DENIED"
        ) {
          blockingDenial = true;
        }
      }

      const dependencies = await this.resolveDependencyArtifacts(
        input.actorUserId,
        invocation.id,
      );
      for (const binding of dependencies) {
        const reference = binding.reference;
        const classification = isKnownContextClassification(
          reference.classification,
        )
          ? reference.classification
          : null;

        if (
          !classification ||
          !isInvocationTargetClassificationAllowed(
            targetKind,
            classification,
          )
        ) {
          artifactDenials.push(
            artifactDenialFor(
              reference.artifactId,
              reference.artifactVersionId,
              classification ?? "UNKNOWN",
              "TARGET_CLASSIFICATION_DENIED",
            ),
          );
          blockingDenial = true;
          continue;
        }

        const actorHasAccess = await this.artifacts.canReadVersion({
          actorUserId: input.actorUserId,
          artifactVersionId: reference.artifactVersionId,
        });
        if (!actorHasAccess) {
          artifactDenials.push(
            artifactDenialFor(
              reference.artifactId,
              reference.artifactVersionId,
              classification,
              "ACTOR_ACCESS_DENIED",
            ),
          );
          blockingDenial = true;
          continue;
        }

        const audienceHasAccess =
          await this.everyAudienceMemberCanReadArtifact(
            authority.audienceUserIds,
            reference.artifactVersionId,
          );
        if (!audienceHasAccess) {
          artifactDenials.push(
            artifactDenialFor(
              reference.artifactId,
              reference.artifactVersionId,
              classification,
              "AUDIENCE_ACCESS_DENIED",
            ),
          );
          blockingDenial = true;
          continue;
        }

        allowedArtifacts.push(binding);
      }
    }

    const budget = await this.budgets.resolve({
      targetKind,
      targetModelSlug: invocation.targetModelSlug,
    });
    const packed = packContextItems({
      items: policyAllowedItems,
      targetKind,
      budget,
    });
    const packingExclusions = packed.exclusions.map(
      (exclusion): ContextBundlePackingExclusionAudit => ({
        sourceType: exclusion.item.sourceType,
        sourceRefHash: hashValue(
          `${exclusion.item.sourceType}:${exclusion.item.sourceId}`,
        ),
        classification: exclusion.item.classification,
        reason: exclusion.reason,
      }),
    );
    const allowedItems = packed.selections.map(
      (selection) => selection.item,
    );

    const manifest: ContextBundleManifest = {
      version: CONTEXT_POLICY_VERSION,
      packingVersion: CONTEXT_PACKING_VERSION,
      targetKind,
      surfaceKind: authority?.kind ?? "UNKNOWN",
      surfaceScopeHash: hashSurface(
        audience.surfaceId,
        authority?.kind ?? "UNKNOWN",
      ),
      audienceParticipantCount:
        authority?.audienceUserIds.length ??
        audience.participantUserIds.length,
      surfaceCapabilities: [
        ...(authority?.capabilities ?? []),
      ],
      disclosurePolicy:
        authority?.disclosurePolicy ??
        UNKNOWN_DISCLOSURE_POLICY,
      budget,
      usedTokens: packed.usedTokens,
      rawHistoryTokens: packed.rawHistoryTokens,
      compactedStateRequired: packed.compactedStateRequired,
      allowedItems: packed.selections.map((selection) => ({
        snapshotItemId: selection.item.id,
        sourceType: selection.item.sourceType,
        classification: selection.item.classification,
        fingerprint: selection.item.fingerprint,
        estimatedTokens: selection.estimatedTokens,
        selectionReason: selection.selectionReason,
      })),
      allowedArtifacts: allowedArtifacts.map(({ inputName, reference }) => ({
        inputName,
        artifactId: reference.artifactId,
        artifactVersionId: reference.artifactVersionId,
        classification: knownClassification(reference.classification),
        version: reference.version,
        fingerprint: reference.fingerprint,
      })),
      denials,
      packingExclusions,
      artifactDenials,
    };
    const fingerprint = bundleFingerprint(manifest);
    const persisted = await this.persistBundle(
      invocation.id,
      snapshot.id,
      fingerprint,
      manifest,
    );

    if (blockingDenial) {
      throw new ContextAccessDeniedError(
        "Context authorization no longer satisfies the invocation policy",
      );
    }

    return {
      id: persisted.id,
      invocationId: invocation.id,
      snapshotId: snapshot.id,
      fingerprint,
      manifest,
      items: allowedItems,
      artifacts: allowedArtifacts,
      createdAt: persisted.createdAt.toISOString(),
    };
  }

  private async canReadSource(
    actorUserId: string,
    item: ContextSnapshotItemView,
  ): Promise<boolean> {
    try {
      await this.snapshots.assertSourceAccess({
        actorUserId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof ContextAccessDeniedError) {
        return false;
      }
      throw error;
    }
  }

  private async resolveDependencyArtifacts(
    actorUserId: string,
    invocationId: string,
  ): Promise<readonly ResolvedArtifactInput[]> {
    try {
      return await this.artifacts.resolveInputBindings({
        actorUserId,
        targetInvocationId: invocationId,
      });
    } catch (error: unknown) {
      if (error instanceof ArtifactError) {
        throw new ContextValidationError(
          "Invocation dependency artifacts are invalid",
        );
      }
      throw error;
    }
  }

  private everyAudienceMemberCanReadArtifact(
    audienceUserIds: readonly string[],
    artifactVersionId: string,
  ): Promise<boolean> {
    return this.artifacts.canUsersReadVersion({
      actorUserIds: audienceUserIds,
      artifactVersionId,
    });
  }

  private async everyAudienceMemberCanReadSource(
    audienceUserIds: readonly string[],
    item: ContextSnapshotItemView,
    alreadyCheckedActorUserId: string,
  ): Promise<boolean> {
    for (const userId of audienceUserIds) {
      if (userId === alreadyCheckedActorUserId) continue;
      if (!(await this.canReadSource(userId, item))) {
        return false;
      }
    }
    return true;
  }

  private async everyAudienceMemberCanReadScope(
    audienceUserIds: readonly string[],
    scope: ContextSourceScope,
  ): Promise<boolean> {
    for (const userId of audienceUserIds) {
      if (
        !(await this.scopeAuthorities.canRead(
          userId,
          scope,
        ))
      ) {
        return false;
      }
    }
    return true;
  }

  private async resolveSurfaceAuthority(
    actorUserId: string,
    surfaceId: string,
  ): Promise<ResolvedSurfaceAuthority | null> {
    try {
      return await this.surfaceAuthorities.resolve({
        actorUserId,
        surfaceId,
      });
    } catch (error: unknown) {
      if (
        error instanceof SurfaceIdentityUnavailableError ||
        error instanceof SurfaceAuthorityUnavailableError ||
        error instanceof SurfaceAccessDeniedError
      ) {
        return null;
      }
      throw error;
    }
  }

  private async persistBundle(
    invocationId: string,
    snapshotId: string,
    fingerprint: string,
    manifest: ContextBundleManifest,
  ): Promise<{
    id: string;
    snapshotId: string;
    fingerprint: string;
    createdAt: Date;
  }> {
    const existing = await this.db.contextBundle.findUnique({
      where: { invocationId },
      select: {
        id: true,
        snapshotId: true,
        fingerprint: true,
        createdAt: true,
      },
    });
    if (existing) {
      assertFrozenBundle(existing, snapshotId, fingerprint);
      return existing;
    }

    try {
      return await this.db.contextBundle.create({
        data: {
          invocationId,
          snapshotId,
          fingerprint,
          manifest: manifest as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          snapshotId: true,
          fingerprint: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await this.db.contextBundle.findUnique({
        where: { invocationId },
        select: {
          id: true,
          snapshotId: true,
          fingerprint: true,
          createdAt: true,
        },
      });
      if (!replay) throw error;
      assertFrozenBundle(replay, snapshotId, fingerprint);
      return replay;
    }
  }
}

function singleAudienceItem(
  items: readonly ContextSnapshotItemView[],
): ContextSnapshotItemView {
  const audienceItems = items.filter((item) => item.sourceType === "AUDIENCE");
  if (audienceItems.length !== 1 || !audienceItems[0]) {
    throw new ContextValidationError(
      "Context snapshot must contain exactly one audience descriptor",
    );
  }
  return audienceItems[0];
}

function parseAudience(
  actorUserId: string,
  item: ContextSnapshotItemView,
): ContextAudienceClaim {
  const metadata = asRecord(item.metadata);
  if (!metadata) {
    throw new ContextValidationError(
      "Context audience metadata is invalid",
    );
  }

  const surfaceId = boundedId(
    metadata.surfaceId,
    "audience surfaceId",
  );
  if (item.sourceId !== surfaceId) {
    throw new ContextValidationError(
      "Context audience source does not match its surface identity",
    );
  }

  const participantUserIds = parseParticipantIds(
    metadata.participantUserIds,
  );
  if (!participantUserIds.includes(actorUserId)) {
    throw new ContextValidationError(
      "Context audience must contain the invoking actor",
    );
  }

  const focusedProjectId =
    metadata.focusedProjectId === undefined
      ? undefined
      : boundedId(
          metadata.focusedProjectId,
          "audience focusedProjectId",
        );

  return {
    surfaceId,
    participantUserIds,
    ...(focusedProjectId
      ? { focusedProjectId }
      : {}),
  };
}

function parseParticipantIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_AUDIENCE_PARTICIPANTS
  ) {
    throw new ContextValidationError(
      "Context audience participants are invalid",
    );
  }

  const ids = value.map((entry) =>
    boundedId(entry, "audience participantUserId"),
  );
  if (new Set(ids).size !== ids.length) {
    throw new ContextValidationError(
      "Context audience participants must be unique",
    );
  }
  return ids;
}

function inferSourceScope(
  actorUserId: string,
  item: ContextSnapshotItemView,
): ContextSourceScope {
  const metadata = asRecord(item.metadata);
  const retrieval = asRecord(metadata?.retrieval);
  const persistedScope = asRecord(retrieval?.scope);
  if (persistedScope && typeof persistedScope.kind === "string") {
    switch (persistedScope.kind) {
      case "PERSONAL":
        return {
          kind: "PERSONAL",
          ownerUserId: boundedId(
            persistedScope.ownerUserId,
            "retrieval personal ownerUserId",
          ),
        };
      case "PROJECT":
        return {
          kind: "PROJECT",
          projectId: boundedId(
            persistedScope.projectId,
            "retrieval projectId",
          ),
        };
      case "DIRECT_CHAT":
        return {
          kind: "DIRECT_CHAT",
          directConversationId: boundedId(
            persistedScope.directConversationId,
            "retrieval directConversationId",
          ),
        };
      default:
        throw new ContextValidationError(
          "Persisted retrieval source scope is invalid",
        );
    }
  }

  if (item.sourceType === "PROJECT") {
    return { kind: "PROJECT", projectId: item.sourceId };
  }
  return { kind: "PERSONAL", ownerUserId: actorUserId };
}

function artifactDenialFor(
  artifactId: string,
  artifactVersionId: string,
  classification: ContextClassification | "UNKNOWN",
  reason: ContextBundleArtifactDenialAudit["reason"],
): ContextBundleArtifactDenialAudit {
  return {
    artifactRefHash: hashValue(
      `ARTIFACT:${artifactId}:${artifactVersionId}`,
    ),
    classification,
    reason,
  };
}

function knownClassification(value: string): ContextClassification {
  if (!isKnownContextClassification(value)) {
    throw new ContextValidationError(
      "Allowed artifact has an invalid classification",
    );
  }
  return value;
}

function denialFor(
  item: ContextSnapshotItemView,
  reason: ContextBundleDenialReason,
): ContextBundleDenialAudit {
  return {
    sourceType: item.sourceType,
    sourceRefHash: hashValue(`${item.sourceType}:${item.sourceId}`),
    classification: item.classification,
    reason,
  };
}

function hashSurface(
  surfaceId: string,
  surfaceKind: CommunicationSurfaceKind | "UNKNOWN",
): string {
  return hashValue(
    `${surfaceKind}:${surfaceId}`,
  );
}

function sameAudience(
  claimed: readonly string[],
  current: readonly string[],
): boolean {
  const left = [...claimed].sort();
  const right = [...current].sort();
  return (
    left.length === right.length &&
    left.every(
      (userId, index) => userId === right[index],
    )
  );
}

function authoritySupportsInvocation(
  authority: ResolvedSurfaceAuthority,
  targetKind: ContextInvocationTargetKind,
): boolean {
  const capability =
    targetKind === "VIMLA"
      ? "ACTION_INVOKE"
      : "AI_INVOKE";
  return authority.capabilities.includes(capability);
}

const UNKNOWN_DISCLOSURE_POLICY: SurfaceDisclosurePolicy = {
  serverPlaintextAvailable: false,
  clientDisclosureRequired: true,
  peerContentRequiresConsent: true,
};

function bundleFingerprint(manifest: ContextBundleManifest): string {
  return hashValue(
    canonicalJson(manifest as unknown as Prisma.InputJsonValue),
  );
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseTargetKind(value: string): ContextInvocationTargetKind {
  switch (value) {
    case "VIMLA":
    case "AI_AUTO":
    case "AI_MODEL":
    case "AGENT":
    case "EVALUATOR":
      return value;
    default:
      throw new ContextValidationError(
        "Invocation target is unsupported by ContextPolicy",
      );
  }
}

function boundedId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new ContextValidationError(`${field} is invalid`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertFrozenBundle(
  existing: {
    snapshotId: string;
    fingerprint: string;
  },
  snapshotId: string,
  fingerprint: string,
): void {
  if (
    existing.snapshotId !== snapshotId ||
    existing.fingerprint !== fingerprint
  ) {
    throw new ContextAccessDeniedError(
      "Context authorization changed after the invocation bundle was frozen",
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
