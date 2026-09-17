import type { PrismaClient } from "@vimla/database";
import { Prisma } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextConflictError,
  ContextNotFoundError,
  ContextValidationError,
} from "./errors.js";
import { fingerprintContextItem, fingerprintContextSnapshot } from "./fingerprint.js";
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
const RECENT_MESSAGE_LIMIT = 20;

type SnapshotRow = Prisma.ContextSnapshotGetPayload<{
  include: { items: true };
}>;

export class ContextSnapshotService {
  constructor(
    private readonly db: PrismaClient,
    private readonly accessVerifier?: ContextAccessVerifier,
  ) {}

  async createForExecutionPlan(input: CreateExecutionPlanSnapshotInput): Promise<ContextSnapshotView> {
    const existing = await this.findOwnedSnapshot(input.actorUserId, input.planId);
    if (existing) {
      return toView(existing);
    }

    const items = await this.collectExecutionPlanItems(input.actorUserId, input.planId);
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

  async resolveForInvocation(input: ResolveInvocationContextInput): Promise<ContextSnapshotView> {
    const invocation = await this.db.invocation.findFirst({
      where: { id: input.invocationId, plan: { userId: input.actorUserId } },
      select: { planId: true },
    });
    if (!invocation) {
      throw new ContextNotFoundError("Invocation not found");
    }

    const snapshot = await this.getByPlan(input.actorUserId, invocation.planId);
    for (const item of snapshot.items) {
      await this.assertSourceAccess({
        actorUserId: input.actorUserId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      });
    }
    return snapshot;
  }

  async assertSourceAccess(check: ContextAccessCheck): Promise<void> {
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
        if (plan.status !== "PLANNED") {
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
    const plan = await this.db.executionPlan.findFirst({
      where: { id: planId, userId: actorUserId },
      select: {
        status: true,
        message: {
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            conversation: {
              select: {
                id: true,
                title: true,
                kind: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            updatedAt: true,
            preference: {
              select: { locale: true, timezone: true, updatedAt: true },
            },
          },
        },
      },
    });
    if (!plan) {
      throw new ContextNotFoundError("Execution plan not found");
    }
    if (plan.status !== "PLANNED") {
      throw new ContextConflictError("Context snapshot must be frozen before execution starts");
    }

    const sourceMessage = plan.message;
    const recentMessages = await this.db.message.findMany({
      where: {
        conversationId: sourceMessage.conversation.id,
        id: { not: sourceMessage.id },
        status: "COMPLETE",
        createdAt: { lte: sourceMessage.createdAt },
      },
      select: {
        id: true,
        role: true,
        content: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_MESSAGE_LIMIT,
    });

    const workspaceObjects = await this.db.workspaceObject.findMany({
      where: {
        sourceMessageId: sourceMessage.id,
        personalOwnerUserId: actorUserId,
      },
      select: {
        id: true,
        kind: true,
        scopeType: true,
        archivedAt: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const items: ContextSnapshotItemInput[] = [
      {
        sourceType: "USER_MESSAGE",
        sourceId: sourceMessage.id,
        sourceVersion: sourceMessage.updatedAt.toISOString(),
        classification: "PRIVATE",
        contentRef: `vimla://messages/${sourceMessage.id}`,
        metadata: {
          role: sourceMessage.role,
          content: sourceMessage.content,
          status: sourceMessage.status,
          createdAt: sourceMessage.createdAt.toISOString(),
        },
      },
      {
        sourceType: "CONVERSATION",
        sourceId: sourceMessage.conversation.id,
        sourceVersion: sourceMessage.conversation.updatedAt.toISOString(),
        classification: "PRIVATE",
        contentRef: `vimla://conversations/${sourceMessage.conversation.id}`,
        metadata: {
          title: sourceMessage.conversation.title,
          kind: sourceMessage.conversation.kind,
          createdAt: sourceMessage.conversation.createdAt.toISOString(),
        },
      },
      ...recentMessages.reverse().map(
        (message): ContextSnapshotItemInput => ({
          sourceType: "MESSAGE",
          sourceId: message.id,
          sourceVersion: message.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://messages/${message.id}`,
          metadata: {
            role: message.role,
            content: message.content,
            status: message.status,
            createdAt: message.createdAt.toISOString(),
          },
        }),
      ),
      {
        sourceType: "PARTICIPANT",
        sourceId: plan.user.id,
        sourceVersion: plan.user.updatedAt.toISOString(),
        classification: "PRIVATE",
        contentRef: `vimla://users/${plan.user.id}`,
        metadata: { name: plan.user.name },
      },
      {
        sourceType: "LOCALE_TIMEZONE",
        sourceId: plan.user.id,
        sourceVersion: (plan.user.preference?.updatedAt ?? plan.user.updatedAt).toISOString(),
        classification: "PRIVATE",
        metadata: {
          locale: plan.user.preference?.locale ?? null,
          timezone: plan.user.preference?.timezone ?? null,
        },
      },
      {
        sourceType: "AUDIENCE",
        sourceId: sourceMessage.conversation.id,
        sourceVersion: sourceMessage.conversation.updatedAt.toISOString(),
        classification: "PRIVATE",
        metadata: {
          kind: "PERSONAL",
          participantUserIds: [actorUserId],
        },
      },
      ...workspaceObjects.map(
        (object): ContextSnapshotItemInput => ({
          sourceType: "WORKSPACE_OBJECT",
          sourceId: object.id,
          sourceVersion: object.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://workspace/${object.id}`,
          metadata: {
            kind: object.kind,
            scopeType: object.scopeType,
            archivedAt: object.archivedAt?.toISOString() ?? null,
            deletedAt: object.deletedAt?.toISOString() ?? null,
            createdAt: object.createdAt.toISOString(),
          },
        }),
      ),
    ];

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
      case "ATTACHMENT":
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
    case "PARTICIPANT":
    case "PROJECT":
    case "WORKSPACE_OBJECT":
    case "ATTACHMENT":
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
