import type { PrismaClient } from "@vimla/database";
import { Prisma } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextConflictError,
  ContextNotFoundError,
  ContextValidationError,
} from "./errors.js";
import { fingerprintContextItem, fingerprintContextSnapshot } from "./fingerprint.js";
import { canReadCompactedState } from "./compaction.js";
import { canReadMemoryItem } from "./memory.js";
import { ContextRetrievalService } from "./retrieval.js";
import type {
  ContextAccessCheck,
  ContextAccessVerifier,
  ContextClassification,
  ContextSnapshotItemInput,
  ContextSnapshotItemView,
  ContextSnapshotView,
  ContextSourceType,
  CreateContextSnapshotInput,
  CreateExecutionPlanSnapshotInput,
  ResolveInvocationContextInput,
} from "./types.js";

const MAX_SNAPSHOT_ITEMS = 128;

type SnapshotRow = Prisma.ContextSnapshotGetPayload<{
  include: { items: true };
}>;

export class ContextSnapshotService {
  private readonly retrieval: ContextRetrievalService;

  constructor(
    private readonly db: PrismaClient,
    private readonly accessVerifier?: ContextAccessVerifier,
    retrievalService?: ContextRetrievalService,
  ) {
    this.retrieval =
      retrievalService ?? new ContextRetrievalService(db);
  }

  async createForExecutionPlan(input: CreateExecutionPlanSnapshotInput): Promise<ContextSnapshotView> {
    const existing = await this.findOwnedSnapshot(input.actorUserId, input.planId);
    if (existing) {
      return toView(existing);
    }

    const items = await this.collectExecutionPlanItems(
      input.actorUserId,
      input.planId,
    );
    return this.persistSnapshot({ ...input, items }, true);
  }

  async create(input: CreateContextSnapshotInput): Promise<ContextSnapshotView> {
    return this.persistSnapshot(input, false);
  }

  async getByPlan(actorUserId: string, planId: string): Promise<ContextSnapshotView> {
    const snapshot = await this.findOwnedSnapshot(actorUserId, planId);
    if (!snapshot) {
      throw new ContextNotFoundError("Context snapshot not found");
    }
    return toView(snapshot);
  }

  async resolveForPlan(
    actorUserId: string,
    planId: string,
  ): Promise<ContextSnapshotView> {
    const snapshot = await this.getByPlan(actorUserId, planId);
    for (const item of snapshot.items) {
      await this.assertSourceAccess({
        actorUserId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      });
    }
    return snapshot;
  }

  async resolveForInvocation(input: ResolveInvocationContextInput): Promise<ContextSnapshotView> {
    const invocation = await this.db.invocation.findFirst({
      where: { id: input.invocationId, plan: { userId: input.actorUserId } },
      select: { planId: true },
    });
    if (!invocation) {
      throw new ContextNotFoundError("Invocation not found");
    }

    return this.resolveForPlan(
      input.actorUserId,
      invocation.planId,
    );
  }

  async assertSourceAccess(check: ContextAccessCheck): Promise<void> {
    if (check.sourceType === "E2EE_DISCLOSURE") {
      throw new ContextAccessDeniedError(
        "E2EE disclosure requires the specialized Direct Chat consent gate",
      );
    }
    if (await this.hasBuiltInAccess(check)) {
      return;
    }
    if (this.accessVerifier && (await this.accessVerifier(check))) {
      return;
    }
    throw new ContextAccessDeniedError("Context source is no longer accessible");
  }

  private async persistSnapshot(
    input: CreateContextSnapshotInput,
    firstWriteWins: boolean,
  ): Promise<ContextSnapshotView> {
    validateItems(input.items);
    const fingerprint = fingerprintContextSnapshot(input.items);
    const prepared = input.items.map((item, sequence) => ({
      item,
      sequence,
      fingerprint: fingerprintContextItem(item),
    }));

    try {
      const snapshot = await this.db.$transaction(async (tx) => {
        const existing = await tx.contextSnapshot.findFirst({
          where: { planId: input.planId, plan: { userId: input.actorUserId } },
          include: { items: true },
        });
        if (existing) {
          if (!firstWriteWins && existing.fingerprint !== fingerprint) {
            throw new ContextConflictError("A different context snapshot already exists for this plan");
          }
          return existing;
        }

        const plan = await tx.executionPlan.findFirst({
          where: { id: input.planId, userId: input.actorUserId },
          select: { id: true, status: true },
        });
        if (!plan) {
          throw new ContextNotFoundError("Execution plan not found");
        }
        if (plan.status !== "PLANNING" && plan.status !== "PLANNED") {
          throw new ContextConflictError("Context snapshot can only be created before execution starts");
        }

        return tx.contextSnapshot.create({
          data: {
            planId: input.planId,
            version: 1,
            fingerprint,
            items: {
              create: prepared.map(({ item, sequence, fingerprint: itemFingerprint }) => ({
                sequence,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                sourceVersion: item.sourceVersion ?? null,
                fingerprint: itemFingerprint,
                classification: item.classification,
                contentRef: item.contentRef ?? null,
                metadata:
                  item.metadata === undefined || item.metadata === null ? Prisma.JsonNull : item.metadata,
              })),
            },
          },
          include: { items: true },
        });
      });

      return toView(snapshot);
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await this.findOwnedSnapshot(input.actorUserId, input.planId);
      if (!existing) {
        throw error;
      }
      if (!firstWriteWins && existing.fingerprint !== fingerprint) {
        throw new ContextConflictError("A different context snapshot already exists for this plan");
      }
      return toView(existing);
    }
  }

  private async collectExecutionPlanItems(
    actorUserId: string,
    planId: string,
  ): Promise<ContextSnapshotItemInput[]> {
    const candidateSet =
      await this.retrieval.retrieveForExecutionPlan({
        actorUserId,
        planId,
      });
    const items = candidateSet.candidates.map(
      (candidate) => candidate.item,
    );
    validateItems(items);
    return items;
  }

  private async findOwnedSnapshot(actorUserId: string, planId: string): Promise<SnapshotRow | null> {
    return this.db.contextSnapshot.findFirst({
      where: { planId, plan: { userId: actorUserId } },
      include: { items: true },
    });
  }

  private async hasBuiltInAccess(check: ContextAccessCheck): Promise<boolean> {
    switch (check.sourceType) {
      case "USER_MESSAGE":
      case "MESSAGE":
        return Boolean(
          await this.db.message.findFirst({
            where: { id: check.sourceId, conversation: { userId: check.actorUserId } },
            select: { id: true },
          }),
        );
      case "E2EE_DISCLOSURE":
        // Execution-owned E2EE disclosures require the specialized
        // membership + consent gate. Generic snapshot access must fail closed.
        return false;
      case "CONVERSATION":
      case "AUDIENCE":
        return Boolean(
          await this.db.conversation.findFirst({
            where: { id: check.sourceId, userId: check.actorUserId },
            select: { id: true },
          }),
        );
      case "PARTICIPANT":
      case "LOCALE_TIMEZONE":
        return check.sourceId === check.actorUserId;
      case "WORKSPACE_OBJECT":
        return Boolean(
          await this.db.workspaceObject.findFirst({
            where: {
              id: check.sourceId,
              personalOwnerUserId: check.actorUserId,
              deletedAt: null,
            },
            select: { id: true },
          }),
        );
      case "PROJECT":
        return Boolean(
          await this.db.project.findFirst({
            where: {
              id: check.sourceId,
              OR: [
                { ownerUserId: check.actorUserId },
                { members: { some: { userId: check.actorUserId } } },
              ],
            },
            select: { id: true },
          }),
        );
      case "ARTIFACT":
        return Boolean(
          await this.db.artifact.findFirst({
            where: {
              id: check.sourceId,
              OR: [
                {
                  creatorInvocation: {
                    plan: { userId: check.actorUserId },
                  },
                },
                {
                  accessGrants: {
                    some: {
                      granteeUserId: check.actorUserId,
                      permission: "READ",
                      revokedAt: null,
                    },
                  },
                },
              ],
            },
            select: { id: true },
          }),
        );
      case "COMPACTED_STATE":
        return canReadCompactedState(
          this.db,
          check.actorUserId,
          check.sourceId,
        );
      case "MEMORY":
        return canReadMemoryItem(
          this.db,
          check.actorUserId,
          check.sourceId,
        );
      case "ATTACHMENT":
      case "FILE_METADATA":
      case "ENTITY":
        return false;
    }
  }
}

function validateItems(items: readonly ContextSnapshotItemInput[]): void {
  if (items.length === 0) {
    throw new ContextValidationError("Context snapshot must contain at least one item");
  }
  if (items.length > MAX_SNAPSHOT_ITEMS) {
    throw new ContextValidationError(`Context snapshot exceeds ${MAX_SNAPSHOT_ITEMS} items`);
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (!item.sourceId.trim() || item.sourceId.length > 512) {
      throw new ContextValidationError("Context source id is invalid");
    }
    if (item.sourceVersion !== undefined && item.sourceVersion !== null && item.sourceVersion.length > 512) {
      throw new ContextValidationError("Context source version is too long");
    }
    if (item.contentRef !== undefined && item.contentRef !== null && item.contentRef.length > 2048) {
      throw new ContextValidationError("Context content reference is too long");
    }
    const key = `${item.sourceType}:${item.sourceId}`;
    if (seen.has(key)) {
      throw new ContextValidationError("Context snapshot contains a duplicate source");
    }
    seen.add(key);
  }
}

function toView(snapshot: SnapshotRow): ContextSnapshotView {
  if (!snapshot.planId) {
    throw new ContextValidationError(
      "Execution-plan context snapshot has an invalid owner",
    );
  }
  return {
    id: snapshot.id,
    planId: snapshot.planId,
    version: snapshot.version,
    fingerprint: snapshot.fingerprint,
    createdAt: snapshot.createdAt.toISOString(),
    items: [...snapshot.items]
      .sort((left, right) => left.sequence - right.sequence)
      .map(
        (item): ContextSnapshotItemView => ({
          id: item.id,
          sequence: item.sequence,
          sourceType: parseSourceType(item.sourceType),
          sourceId: item.sourceId,
          sourceVersion: item.sourceVersion,
          classification: parseClassification(item.classification),
          contentRef: item.contentRef,
          metadata: item.metadata,
          fingerprint: item.fingerprint,
          createdAt: item.createdAt.toISOString(),
        }),
      ),
  };
}

function parseSourceType(value: string): ContextSourceType {
  switch (value) {
    case "USER_MESSAGE":
    case "CONVERSATION":
    case "MESSAGE":
    case "E2EE_DISCLOSURE":
    case "PARTICIPANT":
    case "PROJECT":
    case "WORKSPACE_OBJECT":
    case "ATTACHMENT":
    case "FILE_METADATA":
    case "ARTIFACT":
    case "COMPACTED_STATE":
    case "MEMORY":
    case "ENTITY":
    case "LOCALE_TIMEZONE":
    case "AUDIENCE":
      return value;
    default:
      throw new ContextValidationError("Persisted context source type is invalid");
  }
}

function parseClassification(value: string): ContextClassification {
  switch (value) {
    case "PUBLIC":
    case "INTERNAL":
    case "PRIVATE":
    case "RESTRICTED":
      return value;
    default:
      throw new ContextValidationError("Persisted context classification is invalid");
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
