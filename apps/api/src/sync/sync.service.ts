import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  syncDeltaSchema,
  syncResponseSchema,
  type SyncDelta,
  type SyncResponse,
} from "@vimla/contracts";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  SyncCursorCodec,
  SyncCursorDecodeError,
} from "./sync-cursor.codec.js";

@Injectable()
export class SyncService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(SyncCursorCodec)
    private readonly cursors: SyncCursorCodec,
  ) {}

  async read(
    userId: string,
    input: {
      cursor?: string;
      limit: number;
    },
  ): Promise<SyncResponse> {
    const state =
      await this.prisma.client.userSyncState.findUnique({
        where: { userId },
        select: {
          lastPosition: true,
          minRetainedPosition: true,
        },
      });
    const head = state?.lastPosition ?? 0n;
    const minRetained =
      state?.minRetainedPosition ?? 0n;

    let position = 0n;
    if (input.cursor) {
      try {
        position = this.cursors.decode(
          userId,
          input.cursor,
        );
      } catch (error: unknown) {
        if (error instanceof SyncCursorDecodeError) {
          throw new BadRequestException({
            code: "sync_cursor_invalid",
            message: "Sync cursor is invalid",
          });
        }
        throw error;
      }
    }

    if (
      position < minRetained ||
      position > head
    ) {
      throw new ConflictException({
        code: "sync_cursor_stale",
        message: "Sync cursor is no longer valid",
      });
    }

    const scanLimit = Math.min(
      SYNC_LIMITS.maxScanPerPage,
      Math.max(input.limit, input.limit * 4),
    );
    const candidates =
      await this.prisma.client.durableEventRecipient.findMany({
        where: {
          userId,
          position: {
            gt: position,
            lte: head,
          },
        },
        orderBy: { position: "asc" },
        take: scanLimit,
        include: { event: true },
      });

    const directChatIds = [
      ...new Set(
        candidates
          .filter(
            (row) =>
              row.event.scopeKind ===
                "DIRECT_CHAT" &&
              row.event.changeKind !== "TOMBSTONE",
          )
          .map((row) => row.event.scopeId),
      ),
    ];
    const memberships =
      directChatIds.length === 0
        ? []
        : await this.prisma.client.directConversationMember.findMany({
            where: {
              userId,
              conversationId: {
                in: directChatIds,
              },
            },
            select: {
              conversationId: true,
            },
          });
    const allowedDirectChats = new Set(
      memberships.map(
        (membership) =>
          membership.conversationId,
      ),
    );

    const deltas: SyncDelta[] = [];
    let nextPosition = position;
    for (const candidate of candidates) {
      const event = candidate.event;
      const eligible =
        event.changeKind === "TOMBSTONE" ||
        (event.scopeKind === "DIRECT_CHAT" &&
          allowedDirectChats.has(event.scopeId));

      if (eligible) {
        if (deltas.length >= input.limit) {
          break;
        }
        deltas.push(toSyncDelta(event));
      }

      nextPosition = candidate.position;
      if (deltas.length >= input.limit) {
        break;
      }
    }

    if (
      candidates.length === 0 &&
      nextPosition < head
    ) {
      throw new InternalServerErrorException(
        "Sync stream is inconsistent",
      );
    }

    return syncResponseSchema.parse({
      syncProtocolVersion: SYNC_PROTOCOL_VERSION,
      deltas,
      nextCursor: this.cursors.encode(
        userId,
        nextPosition,
      ),
      hasMore: nextPosition < head,
    });
  }
}

function toSyncDelta(event: {
  id: string;
  eventType: string;
  changeKind: string;
  scopeKind: string;
  scopeId: string;
  occurredAt: Date;
  payload: unknown;
}): SyncDelta {
  if (
    event.eventType !==
      "DIRECT_MESSAGE_CREATED" &&
    event.eventType !==
      "DIRECT_MESSAGE_DELETED"
  ) {
    throw new InternalServerErrorException(
      "Unsupported durable sync event",
    );
  }

  return syncDeltaSchema.parse({
    syncProtocolVersion: SYNC_PROTOCOL_VERSION,
    eventId: event.id,
    eventType: event.eventType,
    changeKind: event.changeKind,
    scope: {
      kind: event.scopeKind,
      id: event.scopeId,
    },
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  });
}
