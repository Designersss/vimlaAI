import { createHash } from "node:crypto";
import { handleInputSchema } from "@vimla/contracts";
import {
  abuseReportReceiptSchema,
  blockedUserSchema,
  blockedUsersResponseSchema,
  surfacePreferenceSchema,
  type AbuseReportReceipt,
  type BlockedUsersQuery,
  type BlockedUsersResponse,
  type CreateAbuseReport,
  type SurfacePreference,
  type UpdateSurfacePreference,
  type UserBlockState,
} from "@vimla/contracts";
import { Prisma, type PrismaClient } from "@vimla/database";
import { TrustError } from "./errors.js";
import {
  lockTrustUserPair,
  type TrustPolicyDb,
} from "./policy.js";

export interface SurfaceAccessPolicy {
  canReadSurface(actorUserId: string, surfaceId: string): Promise<boolean>;
}

type ResolvedUser = {
  userId: string;
  handle: string;
};

type BlockedProfileRow = {
  blockId: string;
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
};

export class TrustService {
  constructor(
    private readonly db: PrismaClient,
    private readonly surfaceAccess?: SurfaceAccessPolicy,
  ) {}

  async blockUser(
    actorUserId: string,
    handleInput: string,
  ): Promise<UserBlockState> {
    return this.db.$transaction(async (tx) => {
      const target = await this.resolveUser(handleInput, tx);
      if (!target) {
        throw new TrustError("NOT_FOUND", "User was not found");
      }
      if (target.userId === actorUserId) {
        throw new TrustError("VALIDATION_ERROR", "You cannot block yourself");
      }
      if (!(await lockTrustUserPair(tx, actorUserId, target.userId))) {
        throw new TrustError("NOT_FOUND", "User was not found");
      }

      const existing = await tx.userBlock.findUnique({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: actorUserId,
            blockedUserId: target.userId,
          },
        },
        select: { id: true },
      });
      if (!existing) {
        await tx.userBlock.create({
          data: {
            blockerUserId: actorUserId,
            blockedUserId: target.userId,
          },
        });
        await bumpDirectInteractionEpoch(
          tx,
          actorUserId,
          target.userId,
        );
      }
      return {
        handle: target.handle,
        blockedByMe: true,
      };
    });
  }

  async unblockUser(
    actorUserId: string,
    handleInput: string,
  ): Promise<UserBlockState> {
    return this.db.$transaction(async (tx) => {
      const target = await this.resolveBlockedUser(
        actorUserId,
        handleInput,
        tx,
      );
      if (!target) {
        throw new TrustError("NOT_FOUND", "Blocked user was not found");
      }
      if (!(await lockTrustUserPair(tx, actorUserId, target.userId))) {
        throw new TrustError("NOT_FOUND", "Blocked user was not found");
      }

      const deleted = await tx.userBlock.deleteMany({
        where: {
          blockerUserId: actorUserId,
          blockedUserId: target.userId,
        },
      });
      if (deleted.count !== 1) {
        throw new TrustError("NOT_FOUND", "Blocked user was not found");
      }
      await bumpDirectInteractionEpoch(
        tx,
        actorUserId,
        target.userId,
      );
      return {
        handle: target.handle,
        blockedByMe: false,
      };
    });
  }

  async listBlockedUsers(
    actorUserId: string,
    query: BlockedUsersQuery,
  ): Promise<BlockedUsersResponse> {
    const cursor = query.cursor
      ? decodeBlockedUsersCursor(query.cursor)
      : null;

    const cursorPredicate = cursor
      ? Prisma.sql`AND (
          block."createdAt" < ${cursor.createdAt}
          OR (
            block."createdAt" = ${cursor.createdAt}
            AND block."id" < ${cursor.id}::uuid
          )
        )`
      : Prisma.sql``;

    const rows = await this.db.$queryRaw<BlockedProfileRow[]>(Prisma.sql`
      SELECT
        block."id" AS "blockId",
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl",
        block."createdAt" AS "createdAt"
      FROM "user_block" AS block
      INNER JOIN "public_profile" AS profile
        ON profile."userId" = block."blockedUserId"
      INNER JOIN "handle" AS handle
        ON handle."id" = profile."handleId"
      WHERE
        block."blockerUserId" = ${actorUserId}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
        ${cursorPredicate}
      ORDER BY
        block."createdAt" DESC,
        block."id" DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.slice(0, query.limit);
    const items = page.map((row) =>
      blockedUserSchema.parse({
        userId: row.userId,
        handle: row.handle,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        createdAt: row.createdAt.toISOString(),
      }),
    );
    const last = page.at(-1);
    return blockedUsersResponseSchema.parse({
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeBlockedUsersCursor(last)
          : null,
    });
  }

  async createReport(
    actorUserId: string,
    input: CreateAbuseReport,
  ): Promise<AbuseReportReceipt> {
    const requestFingerprint =
      abuseReportRequestFingerprint(input);
    const existing = await this.db.abuseReport.findUnique({
      where: {
        reporterUserId_requestId: {
          reporterUserId: actorUserId,
          requestId: input.requestId,
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        requestFingerprint: true,
      },
    });
    if (existing) {
      return resolveReportReplay(
        existing,
        requestFingerprint,
      );
    }

    const target = await this.resolveUser(input.targetHandle);
    if (!target) {
      throw new TrustError("NOT_FOUND", "User was not found");
    }
    if (target.userId === actorUserId) {
      throw new TrustError("VALIDATION_ERROR", "You cannot report yourself");
    }

    let evidence:
      | {
          directConversationId: string;
          directMessageId: string;
          evidenceSenderUserId: string;
          evidenceSenderDeviceId: string;
          evidenceMessageKind: string;
          evidenceMessageCreatedAt: Date;
          evidenceText: string;
        }
      | undefined;

    if (input.evidence) {
      const row = await this.db.directMessage.findFirst({
        where: {
          id: input.evidence.messageId,
          conversationId: input.evidence.conversationId,
          senderUserId: target.userId,
          kind: { in: ["HUMAN", "OPERATOR_INVOKE"] },
          conversation: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
        select: {
          id: true,
          conversationId: true,
          senderUserId: true,
          senderDeviceId: true,
          kind: true,
          createdAt: true,
        },
      });
      if (!row) {
        throw new TrustError(
          "EVIDENCE_INVALID",
          "Selected Direct Chat evidence is unavailable",
        );
      }
      evidence = {
        directConversationId: row.conversationId,
        directMessageId: row.id,
        evidenceSenderUserId: row.senderUserId,
        evidenceSenderDeviceId: row.senderDeviceId,
        evidenceMessageKind: row.kind,
        evidenceMessageCreatedAt: row.createdAt,
        evidenceText: input.evidence.disclosedText,
      };
    }

    try {
      const created = await this.db.abuseReport.create({
        data: {
          requestId: input.requestId,
          requestFingerprint,
          reporterUserId: actorUserId,
          targetUserId: target.userId,
          reason: input.reason,
          details: input.details ?? null,
          status: "SUBMITTED",
          evidenceKind: evidence ? "DIRECT_MESSAGE" : "NONE",
          ...(evidence ?? {}),
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      return reportReceipt(created);
    } catch (error: unknown) {
      if (
        !(
          error instanceof
          Prisma.PrismaClientKnownRequestError
        ) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const replay = await this.db.abuseReport.findUnique({
        where: {
          reporterUserId_requestId: {
            reporterUserId: actorUserId,
            requestId: input.requestId,
          },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          requestFingerprint: true,
        },
      });
      if (!replay) {
        throw error;
      }
      return resolveReportReplay(
        replay,
        requestFingerprint,
      );
    }
  }

  // Read-only exact persisted replay for rate-limited committed report retries.
  async findExactReportReplay(
    actorUserId: string,
    input: CreateAbuseReport,
  ): Promise<AbuseReportReceipt | null> {
    const existing = await this.db.abuseReport.findUnique({
      where: {
        reporterUserId_requestId: {
          reporterUserId: actorUserId,
          requestId: input.requestId,
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        requestFingerprint: true,
      },
    });
    if (
      !existing ||
      existing.requestFingerprint !== abuseReportRequestFingerprint(input)
    ) {
      return null;
    }
    return reportReceipt(existing);
  }

  async getSurfacePreference(
    actorUserId: string,
    surfaceId: string,
  ): Promise<SurfacePreference> {
    await this.assertSurfaceAccess(actorUserId, surfaceId);
    const stored = await this.db.communicationSurfacePreference.findUnique({
      where: {
        surfaceId_userId: { surfaceId, userId: actorUserId },
      },
      select: {
        muted: true,
        updatedAt: true,
      },
    });
    return surfacePreferenceSchema.parse({
      surfaceId,
      muted: stored?.muted ?? false,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
    });
  }

  async updateSurfacePreference(
    actorUserId: string,
    surfaceId: string,
    input: UpdateSurfacePreference,
  ): Promise<SurfacePreference> {
    await this.assertSurfaceAccess(actorUserId, surfaceId);
    const stored = await this.db.communicationSurfacePreference.upsert({
      where: {
        surfaceId_userId: { surfaceId, userId: actorUserId },
      },
      update: { muted: input.muted },
      create: {
        surfaceId,
        userId: actorUserId,
        muted: input.muted,
      },
      select: {
        muted: true,
        updatedAt: true,
      },
    });
    return surfacePreferenceSchema.parse({
      surfaceId,
      muted: stored.muted,
      updatedAt: stored.updatedAt.toISOString(),
    });
  }

  private async assertSurfaceAccess(
    actorUserId: string,
    surfaceId: string,
  ): Promise<void> {
    if (
      !this.surfaceAccess ||
      !(await this.surfaceAccess.canReadSurface(actorUserId, surfaceId))
    ) {
      throw new TrustError("NOT_FOUND", "Communication surface was not found");
    }
  }

  private async resolveUser(
    handleInput: string,
    db: TrustPolicyDb = this.db,
  ): Promise<ResolvedUser | null> {
    const normalized = handleInputSchema.parse(handleInput);
    const handle = await db.handle.findFirst({
      where: {
        normalized,
        kind: "USER",
        status: "ACTIVE",
        userId: { not: null },
      },
      select: {
        handle: true,
        userId: true,
      },
    });
    if (!handle?.userId) {
      return null;
    }
    return {
      userId: handle.userId,
      handle: handle.handle,
    };
  }

  private async resolveBlockedUser(
    actorUserId: string,
    handleInput: string,
    db: TrustPolicyDb,
  ): Promise<ResolvedUser | null> {
    const normalized = handleInputSchema.parse(handleInput);
    const rows = await db.$queryRaw<ResolvedUser[]>(Prisma.sql`
      SELECT
        handle."userId" AS "userId",
        handle."handle" AS "handle"
      FROM "user_block" AS block
      INNER JOIN "handle" AS handle
        ON handle."userId" = block."blockedUserId"
      WHERE
        block."blockerUserId" = ${actorUserId}
        AND handle."normalized" = ${normalized}
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
      LIMIT 1
    `);
    return rows[0] ?? null;
  }
}


type StoredReportReplay = {
  id: string;
  status: string;
  createdAt: Date;
  requestFingerprint: string;
};

export function abuseReportRequestFingerprint(
  input: CreateAbuseReport,
): string {
  const canonical = JSON.stringify({
    targetHandle: input.targetHandle,
    reason: input.reason,
    details: input.details ?? null,
    evidence: input.evidence
      ? {
          kind: input.evidence.kind,
          conversationId: input.evidence.conversationId,
          messageId: input.evidence.messageId,
          disclosedText: input.evidence.disclosedText,
        }
      : null,
  });
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
}

function resolveReportReplay(
  stored: StoredReportReplay,
  requestFingerprint: string,
): AbuseReportReceipt {
  if (stored.requestFingerprint !== requestFingerprint) {
    throw new TrustError(
      "CONFLICT",
      "Report request id was already used for different content",
    );
  }
  return reportReceipt(stored);
}

function reportReceipt(
  stored: Pick<StoredReportReplay, "id" | "status" | "createdAt">,
): AbuseReportReceipt {
  return abuseReportReceiptSchema.parse({
    id: stored.id,
    status: stored.status,
    createdAt: stored.createdAt.toISOString(),
  });
}


const BLOCKED_USERS_CURSOR_VERSION = 1 as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeBlockedUsersCursor(
  row: Pick<BlockedProfileRow, "blockId" | "createdAt">,
): string {
  return Buffer.from(
    JSON.stringify({
      v: BLOCKED_USERS_CURSOR_VERSION,
      at: row.createdAt.toISOString(),
      id: row.blockId,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeBlockedUsersCursor(
  value: string,
): { createdAt: Date; id: string } {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      !("v" in decoded) ||
      decoded.v !== BLOCKED_USERS_CURSOR_VERSION ||
      !("at" in decoded) ||
      typeof decoded.at !== "string" ||
      !("id" in decoded) ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("invalid blocked users cursor");
    }
    const createdAt = new Date(decoded.at);
    if (
      Number.isNaN(createdAt.getTime()) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        decoded.at,
      ) ||
      createdAt.toISOString() !== decoded.at
    ) {
      throw new Error("invalid blocked users cursor time");
    }
    return {
      createdAt,
      id: decoded.id,
    };
  } catch {
    throw new TrustError(
      "VALIDATION_ERROR",
      "Blocked user cursor is invalid",
    );
  }
}


function directConversationPairKey(
  leftUserId: string,
  rightUserId: string,
): string {
  return [leftUserId, rightUserId].sort().join(":");
}

async function bumpDirectInteractionEpoch(
  tx: Prisma.TransactionClient,
  leftUserId: string,
  rightUserId: string,
): Promise<void> {
  await tx.directConversation.updateMany({
    where: {
      pairKey: directConversationPairKey(
        leftUserId,
        rightUserId,
      ),
    },
    data: {
      interactionEpoch: { increment: 1 },
    },
  });
}
