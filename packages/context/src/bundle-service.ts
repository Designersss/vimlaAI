import { createHash } from "node:crypto";
import { type Prisma, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextNotFoundError,
  ContextValidationError,
} from "./errors.js";
import { canonicalJson } from "./fingerprint.js";
import {
  CONTEXT_POLICY_VERSION,
  evaluateContextPolicy,
  surfaceFromAudience,
  type ContextAudienceDescriptor,
  type ContextInvocationTargetKind,
  type ContextPolicyDenialReason,
  type ContextSourceScope,
  type ContextSurfaceDescriptor,
} from "./policy.js";
import { ContextSnapshotService } from "./service.js";
import type {
  ContextClassification,
  ContextSnapshotItemView,
  ContextSourceType,
  ResolveInvocationContextInput,
} from "./types.js";

const MAX_AUDIENCE_PARTICIPANTS = 64;

export type ContextBundleDenialReason =
  | ContextPolicyDenialReason
  | "INVALID_AUDIENCE";

export interface ContextBundleDenialAudit {
  sourceType: ContextSourceType;
  sourceRefHash: string;
  classification: ContextClassification;
  reason: ContextBundleDenialReason;
}

export interface ContextBundleManifest {
  version: typeof CONTEXT_POLICY_VERSION;
  targetKind: ContextInvocationTargetKind;
  surfaceKind: ContextSurfaceDescriptor["kind"];
  surfaceScopeHash: string;
  audienceParticipantCount: number;
  allowedItems: Array<{
    snapshotItemId: string;
    sourceType: ContextSourceType;
    classification: ContextClassification;
    fingerprint: string;
  }>;
  denials: ContextBundleDenialAudit[];
}

export interface ContextBundleView {
  id: string;
  invocationId: string;
  snapshotId: string;
  fingerprint: string;
  manifest: ContextBundleManifest;
  items: ContextSnapshotItemView[];
  createdAt: string;
}

export class ContextBundleService {
  private readonly snapshots: ContextSnapshotService;

  constructor(
    private readonly db: PrismaClient,
    snapshotService?: ContextSnapshotService,
  ) {
    this.snapshots = snapshotService ?? new ContextSnapshotService(db);
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
    const audience = parseAudience(input.actorUserId, audienceItem);
    const surface = surfaceFromAudience(input.actorUserId, audience);

    const allowedItems: ContextSnapshotItemView[] = [];
    const denials: ContextBundleDenialAudit[] = [];
    let blockingDenial = false;

    if (
      !(await this.audienceMatchesCurrentSurface(
        input.actorUserId,
        audience,
        surface,
      ))
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
          actorUserId: input.actorUserId,
          surface,
          targetKind,
          classification: item.classification,
          sourceScope,
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
            audience,
            sourceScope,
          ));
        const decision = evaluateContextPolicy({
          actorUserId: input.actorUserId,
          surface,
          targetKind,
          classification: item.classification,
          sourceScope,
          actorHasAccess,
          audienceHasAccess,
        });

        if (decision.allowed) {
          allowedItems.push(item);
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
    }

    const manifest: ContextBundleManifest = {
      version: CONTEXT_POLICY_VERSION,
      targetKind,
      surfaceKind: surface.kind,
      surfaceScopeHash: hashSurface(surface),
      audienceParticipantCount: audience.participantUserIds.length,
      allowedItems: allowedItems.map((item) => ({
        snapshotItemId: item.id,
        sourceType: item.sourceType,
        classification: item.classification,
        fingerprint: item.fingerprint,
      })),
      denials,
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

  private async everyAudienceMemberCanReadScope(
    audience: ContextAudienceDescriptor,
    scope: ContextSourceScope,
  ): Promise<boolean> {
    for (const userId of audience.participantUserIds) {
      if (!(await this.hasScopeAccess(userId, scope))) {
        return false;
      }
    }
    return true;
  }

  private async hasScopeAccess(
    userId: string,
    scope: ContextSourceScope,
  ): Promise<boolean> {
    switch (scope.kind) {
      case "PERSONAL":
        return scope.ownerUserId === userId;

      case "PROJECT":
        try {
          await this.snapshots.assertSourceAccess({
            actorUserId: userId,
            sourceType: "PROJECT",
            sourceId: scope.projectId,
          });
          return true;
        } catch (error: unknown) {
          if (error instanceof ContextAccessDeniedError) {
            return false;
          }
          throw error;
        }

      case "DIRECT_CHAT":
        return Boolean(
          await this.db.directConversationMember.findUnique({
            where: {
              conversationId_userId: {
                conversationId: scope.directConversationId,
                userId,
              },
            },
            select: { id: true },
          }),
        );
    }
  }

  private async audienceMatchesCurrentSurface(
    actorUserId: string,
    audience: ContextAudienceDescriptor,
    surface: ContextSurfaceDescriptor,
  ): Promise<boolean> {
    if (!audience.participantUserIds.includes(actorUserId)) {
      return false;
    }

    if (surface.kind === "PERSONAL") {
      return (
        audience.participantUserIds.length === 1 &&
        audience.participantUserIds[0] === actorUserId
      );
    }

    if (surface.kind === "PROJECT") {
      for (const userId of audience.participantUserIds) {
        if (
          !(await this.hasScopeAccess(userId, {
            kind: "PROJECT",
            projectId: surface.projectId,
          }))
        ) {
          return false;
        }
      }
      return true;
    }

    const members = await this.db.directConversationMember.findMany({
      where: { conversationId: surface.directConversationId },
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    const currentIds = members.map((member) => member.userId);
    const claimedIds = [...audience.participantUserIds].sort();
    return (
      currentIds.length === claimedIds.length &&
      currentIds.every((userId, index) => userId === claimedIds[index])
    );
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
): ContextAudienceDescriptor {
  const metadata = asRecord(item.metadata);
  if (!metadata || typeof metadata.kind !== "string") {
    throw new ContextValidationError("Context audience metadata is invalid");
  }

  const participantUserIds = parseParticipantIds(
    metadata.participantUserIds,
  );
  if (!participantUserIds.includes(actorUserId)) {
    throw new ContextValidationError(
      "Context audience must contain the invoking actor",
    );
  }

  switch (metadata.kind) {
    case "PERSONAL":
      return {
        kind: "PERSONAL",
        participantUserIds,
      };

    case "PROJECT": {
      const projectId = boundedId(metadata.projectId, "audience projectId");
      return {
        kind: "PROJECT",
        participantUserIds,
        projectId,
      };
    }

    case "DIRECT_CHAT": {
      const directConversationId = boundedId(
        metadata.directConversationId,
        "audience directConversationId",
      );
      return {
        kind: "DIRECT_CHAT",
        participantUserIds,
        directConversationId,
      };
    }

    default:
      throw new ContextValidationError("Context audience kind is unsupported");
  }
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
  if (item.sourceType === "PROJECT") {
    return { kind: "PROJECT", projectId: item.sourceId };
  }
  return { kind: "PERSONAL", ownerUserId: actorUserId };
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

function hashSurface(surface: ContextSurfaceDescriptor): string {
  switch (surface.kind) {
    case "PERSONAL":
      return hashValue(`PERSONAL:${surface.ownerUserId}`);
    case "PROJECT":
      return hashValue(`PROJECT:${surface.projectId}`);
    case "DIRECT_CHAT":
      return hashValue(`DIRECT_CHAT:${surface.directConversationId}`);
  }
}

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
