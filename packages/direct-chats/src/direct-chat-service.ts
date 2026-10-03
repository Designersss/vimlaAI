import { Prisma } from "@vimla/database";
import {
  DIRECT_CHAT_LIMITS,
  type CreateDirectConversation,
  type DirectConversationPrivacy,
  type DirectConversationSummary,
  type DirectConversationView,
  type DirectEnvelopeView,
  type DirectMessageView,
  type DirectParticipant,
  type MarkDirectChatRead,
  type MessageMentionView,
  type SendDirectMessage,
  type UpdateDirectChatPrivacy,
  type WireEnvelopeDto,
  x3dhInitHeaderSchema,
} from "@vimla/contracts";
import {
  b64ToBytes,
  buildAssociatedData,
  serializeDirectRoutingMentions,
  signaturePayload,
  verifyDirectMessage,
} from "@vimla/e2ee";
import type { DirectChatParticipant } from "./assignee.js";
import {
  filterOperatorContextBundle,
  type ContextMessageClaim,
} from "./consent.js";
import { toDeviceView } from "./device-service.js";
import {
  PrismaDirectChatDurableEventWriter,
  type DirectChatDurableEventWriter,
} from "./durable-events.js";
import { DirectChatError } from "./errors.js";
import { directPairKey } from "./pair-key.js";
import type { ActorContext, DbClient, DirectChatServiceOptions } from "./types.js";

const DEFAULTS: DirectChatServiceOptions = {
  maxCiphertextBytes: DIRECT_CHAT_LIMITS.ciphertextMax,
  maxEnvelopes: DIRECT_CHAT_LIMITS.envelopesMax,
};

export class DirectChatService {
  private readonly options: DirectChatServiceOptions;

  constructor(
    private readonly db: DbClient,
    options?: Partial<DirectChatServiceOptions>,
    private readonly durableEvents: DirectChatDurableEventWriter =
      new PrismaDirectChatDurableEventWriter(),
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async create(actor: ActorContext, input: CreateDirectConversation): Promise<DirectConversationView> {
    const email = input.peerEmail.trim().toLowerCase();
    const peer = await this.db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, emailVerified: true },
      select: { id: true, name: true, email: true, emailVerified: true },
    });
    if (!peer || peer.id === actor.userId) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }
    const pairKey = directPairKey(actor.userId, peer.id);
    const existing = await this.db.directConversation.findUnique({
      where: { pairKey },
      include: conversationInclude,
    });
    if (existing) {
      return this.toView(existing, actor.userId);
    }
    try {
      const created = await this.db.directConversation.create({
        data: {
          pairKey,
          members: {
            create: [{ userId: actor.userId }, { userId: peer.id }],
          },
        },
        include: conversationInclude,
      });
      return this.toView(created, actor.userId);
    } catch (error: unknown) {
      if (!isUnique(error)) {
        throw error;
      }
      const replay = await this.db.directConversation.findUnique({
        where: { pairKey },
        include: conversationInclude,
      });
      if (!replay) {
        throw error;
      }
      return this.toView(replay, actor.userId);
    }
  }

  async get(actor: ActorContext, conversationId: string): Promise<DirectConversationView> {
    const conversation = await this.requireMemberConversation(actor.userId, conversationId);
    return this.toView(conversation, actor.userId);
  }

  async updatePrivacy(
    actor: ActorContext,
    conversationId: string,
    input: UpdateDirectChatPrivacy,
  ): Promise<DirectConversationView> {
    await this.requireMemberConversation(actor.userId, conversationId);
    await this.db.directConversationMember.update({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      data: {
        shareOwnHistoryWithVimla: input.shareOwnHistoryWithVimla,
        includePeerHistoryWhenInvoking: input.includePeerHistoryWhenInvoking,
      },
    });
    return this.get(actor, conversationId);
  }

  async markRead(
    actor: ActorContext,
    conversationId: string,
    input: MarkDirectChatRead,
  ): Promise<DirectConversationView> {
    const occurredAt = new Date();

    await this.db.$transaction(async (tx) => {
      const members = await tx.$queryRaw<
        Array<{
          lastReadMessageSequence: bigint | null;
        }>
      >(Prisma.sql`
        SELECT
          member."lastReadMessageSequence" AS "lastReadMessageSequence"
        FROM "direct_conversation_member" AS member
        WHERE
          member."conversationId" = ${conversationId}
          AND member."userId" = ${actor.userId}
        FOR UPDATE
      `);
      const member = members[0];
      if (!member) {
        throw new DirectChatError(
          "NOT_FOUND",
          "Direct Chat was not found",
        );
      }

      const currentSequence =
        member.lastReadMessageSequence ?? 0n;
      let nextSequence = currentSequence;
      if (input.seenMessageIds.length > 0) {
        const messages = await tx.directMessage.findMany({
          where: {
            conversationId,
            id: { in: input.seenMessageIds },
          },
          select: {
            id: true,
            sequence: true,
            senderUserId: true,
          },
        });
        if (
          messages.length !==
          input.seenMessageIds.length
        ) {
          throw new DirectChatError(
            "VALIDATION_ERROR",
            "Seen Direct Chat messages are invalid",
          );
        }

        const observedPeerSequence = messages.reduce(
          (max, message) =>
            message.senderUserId !== actor.userId &&
            message.sequence > max
              ? message.sequence
              : max,
          0n,
        );
        if (observedPeerSequence > nextSequence) {
          nextSequence = observedPeerSequence;
        }
      }

      const storedPositionChanged =
        nextSequence !==
        member.lastReadMessageSequence;
      const readProgressChanged =
        nextSequence > currentSequence;

      await tx.directConversationMember.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId: actor.userId,
          },
        },
        data: {
          lastReadAt: occurredAt,
          ...(storedPositionChanged
            ? {
                lastReadMessageSequence:
                  nextSequence,
              }
            : {}),
        },
      });

      if (readProgressChanged) {
        await this.durableEvents.directReadUpdated(
          tx,
          {
            conversationId,
            occurredAt,
            recipientUserId: actor.userId,
          },
        );
      }
    });

    return this.get(actor, conversationId);
  }

  async listMessages(
    actor: ActorContext,
    conversationId: string,
    query: { limit: number; cursor?: string; deviceId: string },
  ): Promise<{ items: DirectMessageView[]; nextCursor: string | null }> {
    await this.requireMemberConversation(actor.userId, conversationId);
    await this.requireActiveDevice(actor.userId, query.deviceId);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.directMessage.findMany({
      where: {
        conversationId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { AND: [{ createdAt: cursor.at }, { id: { lt: cursor.id } }] },
              ],
            }
          : {}),
      },
      include: { envelopes: { where: { recipientDeviceId: query.deviceId } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const mentions = await this.readMentionMap(page.map((row) => row.id));
    return {
      items: page.map((row) => toMessageView(row, query.deviceId, mentions.get(row.id) ?? [])),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async preflightSend(
    actor: ActorContext,
    conversationId: string,
    input: SendDirectMessage,
  ): Promise<{
    replay: DirectMessageView | null;
  }> {
    await this.requireMemberConversation(
      actor.userId,
      conversationId,
    );
    return {
      replay: await this.findExactReplay(
        actor.userId,
        conversationId,
        input,
      ),
    };
  }

  async send(
    actor: ActorContext,
    conversationId: string,
    input: SendDirectMessage,
    resolvedMentions: MessageMentionView[] = [],
  ): Promise<DirectMessageView> {
    return (
      await this.sendWithStatus(
        actor,
        conversationId,
        input,
        resolvedMentions,
      )
    ).message;
  }

  async sendWithStatus(
    actor: ActorContext,
    conversationId: string,
    input: SendDirectMessage,
    resolvedMentions: MessageMentionView[] = [],
  ): Promise<{
    message: DirectMessageView;
    replayed: boolean;
  }> {
    const memberIds = (
      await this.requireMemberConversation(
        actor.userId,
        conversationId,
      )
    ).members.map((member) => member.userId);
    const replay = await this.findExactReplay(
      actor.userId,
      conversationId,
      input,
    );
    if (replay) {
      return { message: replay, replayed: true };
    }

    const senderDevice = await this.requireActiveDevice(actor.userId, input.senderDeviceId);
    if (input.envelopes.length > this.options.maxEnvelopes) {
      throw new DirectChatError("VALIDATION_ERROR", "Too many envelopes");
    }

    const memberDevices = await this.db.userCryptoDevice.findMany({
      where: { userId: { in: memberIds }, revokedAt: null },
    });
    const devicesById = new Map(memberDevices.map((device) => [device.id, device]));
    const peerHasDevice = memberDevices.some((device) => device.userId !== actor.userId);
    if (!peerHasDevice) {
      throw new DirectChatError("RECIPIENT_DEVICE_MISSING", "The other participant has no active device");
    }
    const requiredDeviceIds = new Set(memberDevices.map((device) => device.id));
    const providedDeviceIds = new Set(input.envelopes.map((envelope) => envelope.recipientDeviceId));
    if (requiredDeviceIds.size !== providedDeviceIds.size || [...requiredDeviceIds].some((id) => !providedDeviceIds.has(id))) {
      throw new DirectChatError("VALIDATION_ERROR", "Envelopes must cover every active member device");
    }

    const routingContext = input.mentions.length > 0
      ? serializeDirectRoutingMentions(input.mentions)
      : undefined;
    for (const envelope of input.envelopes) {
      this.assertEnvelope(envelope, senderDevice, devicesById, {
        conversationId,
        senderUserId: actor.userId,
        senderDeviceId: senderDevice.id,
        kind: input.kind,
        routingContext,
      });
    }

    try {
      const created = await this.db.$transaction(async (tx) => {
        const message = await tx.directMessage.create({
          data: {
            conversationId,
            senderUserId: actor.userId,
            senderDeviceId: senderDevice.id,
            clientMessageId: input.clientMessageId,
            kind: input.kind,
            envelopes: {
              create: input.envelopes.map((envelope) => ({
                recipientDeviceId: envelope.recipientDeviceId,
                senderDeviceId: senderDevice.id,
                headerB64: envelope.headerB64,
                ciphertextB64: envelope.ciphertextB64,
                dhPublicB64: envelope.dhPublicB64,
                messageNumber: envelope.messageNumber,
                previousChainLength: envelope.previousChainLength,
                senderSignatureB64: envelope.senderSignatureB64,
                x3dhInitJson: envelope.x3dhInit ? JSON.stringify(envelope.x3dhInit) : null,
              })),
            },
          },
          include: { envelopes: true },
        });
        if (resolvedMentions.length > 0) {
          await tx.directMessageMention.createMany({
            data: resolvedMentions.map((mention) => ({
              id: mention.id,
              directMessageId: message.id,
              handleId: mention.handleId,
              kind: mention.kind,
              targetId: mention.targetId,
              canonicalHandle: mention.canonicalHandle,
              startOffset: mention.startOffset,
              endOffset: mention.endOffset,
            })),
          });
        }
        await this.durableEvents.directMessageCreated(
          tx,
          {
            conversationId,
            messageId: message.id,
            occurredAt: message.createdAt,
            recipientUserIds: memberIds,
          },
        );
        return message;
      });
      return {
        message: toMessageView(
          created,
          senderDevice.id,
          resolvedMentions,
        ),
        replayed: false,
      };
    } catch (error: unknown) {
      if (isUnique(error)) {
        const replay = await this.findExactReplay(
          actor.userId,
          conversationId,
          input,
        );
        if (replay) {
          return { message: replay, replayed: true };
        }
        throw new DirectChatError(
          "TAMPERED",
          "Message envelope was rejected",
        );
      }
      throw error;
    }
  }

  async validateOperatorContextDisclosure(
    actorUserId: string,
    conversationId: string,
    sourceMessageId: string,
    messages: readonly ContextMessageClaim[],
  ): Promise<{
    sourceMessageId: string;
    sourceMessageCreatedAt: string;
    memberIds: string[];
    messages: ContextMessageClaim[];
    ownIncluded: boolean;
    peerIncluded: boolean;
    peerDenied: boolean;
  }> {
    const consent = await this.consent(actorUserId, conversationId);
    const source = await this.db.directMessage.findFirst({
      where: {
        id: sourceMessageId,
        conversationId,
        senderUserId: actorUserId,
        kind: "OPERATOR_INVOKE",
      },
      select: { id: true, createdAt: true },
    });
    if (!source) {
      throw new DirectChatError(
        "VALIDATION_ERROR",
        "Direct Chat operator source message is invalid",
      );
    }

    const ids = messages.map((message) => message.messageId);
    if (new Set(ids).size !== ids.length) {
      throw new DirectChatError(
        "VALIDATION_ERROR",
        "Direct Chat context message ids must be unique",
      );
    }
    const rows =
      ids.length === 0
        ? []
        : await this.db.directMessage.findMany({
            where: {
              id: { in: ids },
              conversationId,
            },
            select: {
              id: true,
              senderUserId: true,
              kind: true,
              createdAt: true,
            },
          });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const validated = messages.map((message): ContextMessageClaim => {
      const row = rowById.get(message.messageId);
      if (
        !row ||
        row.kind !== "HUMAN" ||
        row.senderUserId !== message.senderUserId ||
        row.createdAt.toISOString() !== message.sentAt ||
        row.createdAt >= source.createdAt
      ) {
        throw new DirectChatError(
          "VALIDATION_ERROR",
          "Direct Chat context provenance is invalid",
        );
      }
      return {
        ...message,
        senderUserId: row.senderUserId,
        sentAt: row.createdAt.toISOString(),
      };
    });
    validated.sort(
      (left, right) =>
        Date.parse(left.sentAt) - Date.parse(right.sentAt) ||
        left.messageId.localeCompare(right.messageId),
    );

    const filtered = filterOperatorContextBundle({
      actorUserId,
      memberIds: consent.memberIds,
      consent,
      messages: validated,
    });
    return {
      sourceMessageId: source.id,
      sourceMessageCreatedAt: source.createdAt.toISOString(),
      memberIds: consent.memberIds,
      ...filtered,
    };
  }

  async participants(actorUserId: string, conversationId: string): Promise<DirectChatParticipant[]> {
    const conversation = await this.requireMemberConversation(actorUserId, conversationId);
    return conversation.members.map((member) => ({
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
    }));
  }

  async assertCanFetchPrekeys(actorUserId: string, targetUserId: string): Promise<void> {
    if (actorUserId === targetUserId) {
      return;
    }
    const pairKey = directPairKey(actorUserId, targetUserId);
    const shared = await this.db.directConversation.findUnique({ where: { pairKey } });
    if (!shared) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }
  }

  async consent(actorUserId: string, conversationId: string) {
    const conversation = await this.requireMemberConversation(actorUserId, conversationId);
    const mine = conversation.members.find((member) => member.userId === actorUserId);
    const peer = conversation.members.find((member) => member.userId !== actorUserId);
    if (!mine || !peer) {
      throw new DirectChatError("NOT_FOUND", "Direct Chat was not found");
    }
    return {
      actorShareOwnHistoryWithVimla: mine.shareOwnHistoryWithVimla,
      actorIncludePeerHistoryWhenInvoking: mine.includePeerHistoryWhenInvoking,
      peerShareOwnHistoryWithVimla: peer.shareOwnHistoryWithVimla,
      memberIds: conversation.members.map((member) => member.userId),
    };
  }

  private async findExactReplay(
    userId: string,
    conversationId: string,
    input: SendDirectMessage,
  ): Promise<DirectMessageView | null> {
    const existing = await this.db.directMessage.findFirst({
      where: {
        conversationId,
        senderUserId: userId,
        clientMessageId: input.clientMessageId,
        conversation: {
          members: { some: { userId } },
        },
      },
      include: { envelopes: true },
    });
    if (!existing) return null;
    if (existing.senderDeviceId !== input.senderDeviceId) {
      throw new DirectChatError(
        "TAMPERED",
        "Message replay sender device does not match",
      );
    }
    const mentions = await this.readMentionMap([existing.id]);
    const existingMentions = mentions.get(existing.id) ?? [];
    if (
      existing.kind !== input.kind ||
      !sameReplayEnvelopes(
        existing.envelopes,
        input.envelopes,
      ) ||
      !sameReplayMentions(
        existingMentions,
        input.mentions,
      )
    ) {
      throw new DirectChatError(
        "TAMPERED",
        "Message replay payload does not match the original",
      );
    }
    return toMessageView(
      existing,
      input.senderDeviceId,
      existingMentions,
    );
  }

  private async readMentionMap(messageIds: string[]): Promise<Map<string, MessageMentionView[]>> {
    const grouped = new Map<string, MessageMentionView[]>();
    if (messageIds.length === 0) return grouped;
    const rows = await this.db.directMessageMention.findMany({
      where: { directMessageId: { in: messageIds } },
      orderBy: [{ directMessageId: "asc" }, { startOffset: "asc" }],
    });
    for (const row of rows) {
      if (!isMentionKind(row.kind)) continue;
      const current = grouped.get(row.directMessageId) ?? [];
      current.push({
        id: row.id,
        handleId: row.handleId,
        kind: row.kind,
        targetId: row.targetId,
        canonicalHandle: row.canonicalHandle,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      });
      grouped.set(row.directMessageId, current);
    }
    return grouped;
  }

  private assertEnvelope(
    envelope: WireEnvelopeDto,
    senderDevice: { id: string; identityEd25519Public: string },
    devicesById: Map<string, { id: string; revokedAt: Date | null }>,
    ad: {
      conversationId: string;
      senderUserId: string;
      senderDeviceId: string;
      kind: SendDirectMessage["kind"];
      routingContext?: string;
    },
  ): void {
    if (envelope.ciphertextB64.length > this.options.maxCiphertextBytes) {
      throw new DirectChatError("VALIDATION_ERROR", "Ciphertext is too large");
    }
    const recipient = devicesById.get(envelope.recipientDeviceId);
    if (!recipient || recipient.revokedAt) {
      throw new DirectChatError("TAMPERED", "Envelope recipient is not an active chat device");
    }
    const associated = buildAssociatedData({
      conversationId: ad.conversationId,
      senderUserId: ad.senderUserId,
      senderDeviceId: ad.senderDeviceId,
      recipientDeviceId: envelope.recipientDeviceId,
      kind: ad.kind,
      routingContext: ad.routingContext,
    });
    const header = b64ToBytes(envelope.headerB64);
    const ciphertext = b64ToBytes(envelope.ciphertextB64);
    const ok = verifyDirectMessage(
      b64ToBytes(senderDevice.identityEd25519Public),
      signaturePayload(header, ciphertext, associated, envelope.x3dhInit ?? null),
      b64ToBytes(envelope.senderSignatureB64),
    );
    if (!ok) {
      throw new DirectChatError("TAMPERED", "Envelope signature is invalid");
    }
  }

  private async requireMemberConversation(userId: string, conversationId: string) {
    const conversation = await this.db.directConversation.findFirst({
      where: { id: conversationId, members: { some: { userId } } },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new DirectChatError("NOT_FOUND", "Direct Chat was not found");
    }
    return conversation;
  }

  private async requireActiveDevice(userId: string, deviceId: string) {
    const device = await this.db.userCryptoDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) {
      throw new DirectChatError("NOT_FOUND", "Device was not found");
    }
    if (device.revokedAt) {
      throw new DirectChatError("DEVICE_REVOKED", "This device was revoked");
    }
    return device;
  }

  private async toView(
    conversation: ConversationRecord,
    actorUserId: string,
  ): Promise<DirectConversationView> {
    const unreadCount = await this.readUnreadCount(
      actorUserId,
      conversation.id,
    );
    const summary = this.toSummary(
      conversation,
      actorUserId,
      unreadCount,
    );
    const devices = conversation.members.flatMap((member) =>
      member.user.cryptoDevices.filter((device) => device.revokedAt === null).map(toDeviceView),
    );
    return {
      ...summary,
      members: conversation.members.map((member) => toParticipant(member.user)),
      devices,
    };
  }

  private async readUnreadCount(
    actorUserId: string,
    conversationId: string,
  ): Promise<number> {
    const rows = await this.db.$queryRaw<
      Array<{ unreadCount: number }>
    >(Prisma.sql`
      SELECT COUNT(*)::int AS "unreadCount"
      FROM "direct_message" AS message
      INNER JOIN "direct_conversation_member" AS member
        ON member."conversationId" = message."conversationId"
        AND member."userId" = ${actorUserId}
      WHERE
        message."conversationId" = ${conversationId}
        AND message."senderUserId" <> ${actorUserId}
        AND (
          member."lastReadMessageSequence" IS NULL
          OR message."sequence" > member."lastReadMessageSequence"
        )
    `);
    return rows[0]?.unreadCount ?? 0;
  }

  private toSummary(
    conversation: ConversationRecord,
    actorUserId: string,
    unreadCount: number,
  ): DirectConversationSummary {
    const mine = conversation.members.find((member) => member.userId === actorUserId);
    const peer = conversation.members.find((member) => member.userId !== actorUserId);
    if (!mine || !peer) {
      throw new DirectChatError("NOT_FOUND", "Direct Chat was not found");
    }
    const latest = conversation.messages[0];
    if (
      conversation.surface === null ||
      conversation.surface.kind !== "DIRECT"
    ) {
      throw new Error(
        "Direct Chat communication surface binding is invalid",
      );
    }
    return {
      id: conversation.id,
      surfaceId: conversation.surface.id,
      surfaceKind: "DIRECT",
      peer: toParticipant(peer.user),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount,
      lastKind: isKind(latest?.kind) ? latest.kind : null,
      lastSenderUserId: latest?.senderUserId ?? null,
      createdAt: conversation.createdAt.toISOString(),
      privacy: toPrivacy(mine, peer),
    };
  }
}

const conversationInclude = {
  surface: true,
  members: {
    include: {
      user: {
        include: { cryptoDevices: true },
      },
    },
  },
  messages: {
    orderBy: [
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ],
    take: 50,
  },
} satisfies Prisma.DirectConversationInclude;

type ConversationRecord = Prisma.DirectConversationGetPayload<{ include: typeof conversationInclude }>;

function toParticipant(user: { id: string; name: string; email: string }): DirectParticipant {
  return { userId: user.id, name: user.name, email: user.email };
}

function toPrivacy(
  mine: { shareOwnHistoryWithVimla: boolean; includePeerHistoryWhenInvoking: boolean },
  peer: { shareOwnHistoryWithVimla: boolean },
): DirectConversationPrivacy {
  return {
    shareOwnHistoryWithVimla: mine.shareOwnHistoryWithVimla,
    includePeerHistoryWhenInvoking: mine.includePeerHistoryWhenInvoking,
    peerShareOwnHistoryWithVimla: peer.shareOwnHistoryWithVimla,
  };
}

function toMessageView(
  row: {
    id: string;
    conversationId: string;
    senderUserId: string;
    senderDeviceId: string;
    clientMessageId: string;
    kind: string;
    createdAt: Date;
    envelopes: Array<{
      recipientDeviceId: string;
      headerB64: string;
      ciphertextB64: string;
      dhPublicB64: string;
      messageNumber: number;
      previousChainLength: number;
      senderSignatureB64: string;
      x3dhInitJson: string | null;
    }>;
  },
  deviceId: string,
  mentions: MessageMentionView[],
): DirectMessageView {
  const envelope =
    row.envelopes.find(
      (item) => item.recipientDeviceId === deviceId,
    ) ?? null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderUserId: row.senderUserId,
    senderDeviceId: row.senderDeviceId,
    clientMessageId: row.clientMessageId,
    kind: isKind(row.kind) ? row.kind : "HUMAN",
    createdAt: row.createdAt.toISOString(),
    envelope: envelope ? toEnvelopeView(envelope) : null,
    mentions,
  };
}

function toEnvelopeView(envelope: {
  recipientDeviceId: string;
  headerB64: string;
  ciphertextB64: string;
  dhPublicB64: string;
  messageNumber: number;
  previousChainLength: number;
  senderSignatureB64: string;
  x3dhInitJson: string | null;
}): DirectEnvelopeView {
  let x3dhInit = null;
  if (envelope.x3dhInitJson) {
    const parsed = x3dhInitHeaderSchema.safeParse(JSON.parse(envelope.x3dhInitJson) as unknown);
    x3dhInit = parsed.success ? parsed.data : null;
  }
  return {
    recipientDeviceId: envelope.recipientDeviceId,
    headerB64: envelope.headerB64,
    ciphertextB64: envelope.ciphertextB64,
    dhPublicB64: envelope.dhPublicB64,
    messageNumber: envelope.messageNumber,
    previousChainLength: envelope.previousChainLength,
    senderSignatureB64: envelope.senderSignatureB64,
    x3dhInit,
  };
}

function isKind(value: string | undefined): value is DirectMessageView["kind"] {
  return (
    value === "HUMAN" ||
    value === "OPERATOR_INVOKE" ||
    value === "OPERATOR_RESPONSE" ||
    value === "OPERATOR_ACTION"
  );
}

function isMentionKind(value: string): value is MessageMentionView["kind"] {
  return value === "USER" || value === "SYSTEM_AGENT" || value === "AI_AUTO" || value === "AI_MODEL";
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [iso, id] = raw.split("|");
    if (!iso || !id) {
      return null;
    }
    return { at: new Date(iso), id };
  } catch {
    return null;
  }
}

function sameReplayEnvelopes(
  stored: ReadonlyArray<{
    recipientDeviceId: string;
    headerB64: string;
    ciphertextB64: string;
    dhPublicB64: string;
    messageNumber: number;
    previousChainLength: number;
    senderSignatureB64: string;
    x3dhInitJson: string | null;
  }>,
  incoming: readonly WireEnvelopeDto[],
): boolean {
  if (stored.length !== incoming.length) return false;
  const incomingByRecipient = new Map(
    incoming.map((envelope) => [
      envelope.recipientDeviceId,
      envelope,
    ]),
  );
  if (incomingByRecipient.size !== incoming.length) {
    return false;
  }
  return stored.every((envelope) => {
    const candidate = incomingByRecipient.get(
      envelope.recipientDeviceId,
    );
    return (
      candidate !== undefined &&
      candidate.headerB64 === envelope.headerB64 &&
      candidate.ciphertextB64 === envelope.ciphertextB64 &&
      candidate.dhPublicB64 === envelope.dhPublicB64 &&
      candidate.messageNumber === envelope.messageNumber &&
      candidate.previousChainLength ===
        envelope.previousChainLength &&
      candidate.senderSignatureB64 ===
        envelope.senderSignatureB64 &&
      JSON.stringify(candidate.x3dhInit ?? null) ===
        (envelope.x3dhInitJson ?? "null")
    );
  });
}

function sameReplayMentions(
  stored: readonly MessageMentionView[],
  incoming: Readonly<SendDirectMessage["mentions"]>,
): boolean {
  if (stored.length !== incoming.length) return false;
  const canonical = (
    mention: Pick<
      MessageMentionView,
      | "handleId"
      | "kind"
      | "canonicalHandle"
      | "startOffset"
      | "endOffset"
    >,
  ): string =>
    [
      mention.handleId,
      mention.kind,
      mention.canonicalHandle,
      mention.startOffset,
      mention.endOffset,
    ].join("\u0000");
  const storedCanonical = [...stored]
    .map(canonical)
    .sort();
  const incomingCanonical = [...incoming]
    .map(canonical)
    .sort();
  return storedCanonical.every(
    (value, index) =>
      value === incomingCanonical[index],
  );
}


function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
