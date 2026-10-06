import { Prisma } from "@vimla/database";
import {
  DIRECT_CHAT_LIMITS,
  type DirectConversationPrivacy,
  type DirectConversationSummary,
  type DirectConversationView,
  type DirectEnvelopeView,
  type DirectMessageView,
  type DirectMessageSendPreflight,
  type DirectParticipant,
  type MarkDirectChatRead,
  type MessageMentionView,
  type PrekeyBundle,
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
import {
  PrismaUserTrustPolicy,
  lockTrustUserPair,
  type UserTrustPolicy,
} from "@vimla/trust";
import type { DirectChatParticipant } from "./assignee.js";
import {
  filterOperatorContextBundle,
  type ContextMessageClaim,
} from "./consent.js";
import {
  consumePrekeyBundlesForUser,
  toDeviceView,
} from "./device-service.js";
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

type ParticipantProfileRow = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

type DirectMessageReadDb = Pick<
  Prisma.TransactionClient,
  "directMessage" | "directMessageMention"
>;

export class DirectChatService {
  private readonly options: DirectChatServiceOptions;

  constructor(
    private readonly db: DbClient,
    options?: Partial<DirectChatServiceOptions>,
    private readonly durableEvents: DirectChatDurableEventWriter =
      new PrismaDirectChatDurableEventWriter(),
    private readonly trust: UserTrustPolicy =
      new PrismaUserTrustPolicy(db),
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async create(actor: ActorContext, peerUserId: string): Promise<DirectConversationView> {
    if (peerUserId === actor.userId) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }
    if (!(await this.trust.canInteract(actor.userId, peerUserId))) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }
    const peerProfiles = await this.readParticipantProfiles([peerUserId]);
    if (!peerProfiles.has(peerUserId)) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }

    const pairKey = directPairKey(actor.userId, peerUserId);
    const conversation = await this.db.$transaction(async (tx) => {
      const usersExist = await lockTrustUserPair(
        tx,
        actor.userId,
        peerUserId,
      );
      const allowed =
        usersExist &&
        (await new PrismaUserTrustPolicy(tx).canInteract(
          actor.userId,
          peerUserId,
        ));
      if (!allowed) {
        throw new DirectChatError("NOT_FOUND", "User was not found");
      }

      const existing = await tx.directConversation.findUnique({
        where: { pairKey },
        include: conversationInclude,
      });
      if (existing) {
        return existing;
      }
      return tx.directConversation.create({
        data: {
          pairKey,
          members: {
            create: [{ userId: actor.userId }, { userId: peerUserId }],
          },
        },
        include: conversationInclude,
      });
    });
    return this.toView(conversation, actor.userId);
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
      const hasObservedMessages =
        input.seenMessageIds.length > 0;
      if (hasObservedMessages) {
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
        hasObservedMessages &&
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

  async prepareSend(
    actor: ActorContext,
    conversationId: string,
    senderDeviceId: string,
  ): Promise<DirectMessageSendPreflight> {
    return this.db.$transaction(async (tx) => {
      const conversation =
        await tx.directConversation.findFirst({
          where: {
            id: conversationId,
            members: {
              some: { userId: actor.userId },
            },
          },
          select: {
            members: {
              select: { userId: true },
            },
          },
        });
      if (!conversation) {
        throw new DirectChatError(
          "NOT_FOUND",
          "Direct Chat was not found",
        );
      }
      const peerUserId = conversation.members.find(
        (member) => member.userId !== actor.userId,
      )?.userId;
      if (!peerUserId) {
        throw new DirectChatError(
          "FORBIDDEN",
          "Direct Chat interaction is unavailable",
        );
      }

      const device = await tx.userCryptoDevice.findFirst({
        where: {
          id: senderDeviceId,
          userId: actor.userId,
        },
        select: { revokedAt: true },
      });
      if (!device) {
        throw new DirectChatError(
          "NOT_FOUND",
          "Device was not found",
        );
      }
      if (device.revokedAt) {
        throw new DirectChatError(
          "DEVICE_REVOKED",
          "This device was revoked",
        );
      }

      const usersExist = await lockTrustUserPair(
        tx,
        actor.userId,
        peerUserId,
      );
      const allowed =
        usersExist &&
        (await new PrismaUserTrustPolicy(tx).canInteract(
          actor.userId,
          peerUserId,
        ));
      if (!allowed) {
        throw new DirectChatError(
          "FORBIDDEN",
          "Direct Chat interaction is unavailable",
        );
      }

      const current =
        await tx.directConversation.findUnique({
          where: { id: conversationId },
          select: { interactionEpoch: true },
        });
      if (!current) {
        throw new DirectChatError(
          "NOT_FOUND",
          "Direct Chat was not found",
        );
      }
      return {
        interactionEpoch: current.interactionEpoch,
      };
    });
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
    const replay = await this.findExactReplay(
      actor.userId,
      conversationId,
      input,
    );
    return { replay };
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
    const conversation =
      await this.requireMemberConversation(
        actor.userId,
        conversationId,
      );
    const memberIds = conversation.members.map(
      (member) => member.userId,
    );
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
        interactionEpoch: input.interactionEpoch,
        routingContext,
      });
    }

    try {
      return await this.db.$transaction(async (tx) => {
        const peerUserId = memberIds.find(
          (userId) => userId !== actor.userId,
        );
        if (!peerUserId) {
          throw new DirectChatError(
            "FORBIDDEN",
            "Direct Chat interaction is unavailable",
          );
        }

        const usersExist = await lockTrustUserPair(
          tx,
          actor.userId,
          peerUserId,
        );

        // Re-check idempotent replay after taking the same pair lock used by
        // block/unblock. A committed retry must still resolve as success even
        // if a block was established immediately afterwards; conversely, a
        // FORBIDDEN response now proves this clientMessageId was not committed.
        const transactionalReplay =
          await this.findExactReplay(
            actor.userId,
            conversationId,
            input,
            tx,
          );
        if (transactionalReplay) {
          return {
            message: transactionalReplay,
            replayed: true,
          };
        }

        const allowed =
          usersExist &&
          (await new PrismaUserTrustPolicy(tx).canInteract(
            actor.userId,
            peerUserId,
          ));
        if (!allowed) {
          throw new DirectChatError(
            "FORBIDDEN",
            "Direct Chat interaction is unavailable",
          );
        }

        const currentConversation =
          await tx.directConversation.findUnique({
            where: { id: conversationId },
            select: { interactionEpoch: true },
          });
        if (
          !currentConversation ||
          currentConversation.interactionEpoch !==
            input.interactionEpoch
        ) {
          throw new DirectChatError(
            "CONFLICT",
            "Direct Chat interaction state changed",
          );
        }

        const message = await tx.directMessage.create({
          data: {
            conversationId,
            senderUserId: actor.userId,
            senderDeviceId: senderDevice.id,
            clientMessageId: input.clientMessageId,
            kind: input.kind,
            interactionEpoch: input.interactionEpoch,
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
        return {
          message: toMessageView(
            message,
            senderDevice.id,
            resolvedMentions,
          ),
          replayed: false,
        };
      });
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
    const profiles = await this.readParticipantProfiles(
      conversation.members.map((member) => member.userId),
    );
    return conversation.members.map((member) => {
      const participant = requireParticipant(profiles, member.userId);
      return {
        userId: participant.userId,
        handle: participant.handle,
        name: participant.name,
      };
    });
  }

  async prekeyBundles(
    actorUserId: string,
    targetUserId: string,
  ): Promise<PrekeyBundle[]> {
    return this.db.$transaction(async (tx) => {
      if (actorUserId !== targetUserId) {
        const usersExist = await lockTrustUserPair(
          tx,
          actorUserId,
          targetUserId,
        );
        const pairKey = directPairKey(
          actorUserId,
          targetUserId,
        );
        const shared =
          await tx.directConversation.findUnique({
            where: { pairKey },
            select: { id: true },
          });
        const allowed =
          usersExist &&
          shared !== null &&
          (await new PrismaUserTrustPolicy(tx).canInteract(
            actorUserId,
            targetUserId,
          ));
        if (!allowed) {
          throw new DirectChatError(
            "NOT_FOUND",
            "User was not found",
          );
        }
      }
      return consumePrekeyBundlesForUser(
        tx,
        targetUserId,
      );
    });
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
    db: DirectMessageReadDb = this.db,
  ): Promise<DirectMessageView | null> {
    const existing = await db.directMessage.findFirst({
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
    const mentions = await this.readMentionMap(
      [existing.id],
      db,
    );
    const existingMentions = mentions.get(existing.id) ?? [];
    if (
      existing.kind !== input.kind ||
      existing.interactionEpoch !== input.interactionEpoch ||
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

  private async readMentionMap(
    messageIds: string[],
    db: DirectMessageReadDb = this.db,
  ): Promise<Map<string, MessageMentionView[]>> {
    const grouped = new Map<string, MessageMentionView[]>();
    if (messageIds.length === 0) return grouped;
    const rows = await db.directMessageMention.findMany({
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
      interactionEpoch: number;
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
      interactionEpoch: ad.interactionEpoch,
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

  private async readParticipantProfiles(
    userIds: string[],
  ): Promise<Map<string, DirectParticipant>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.db.$queryRaw<ParticipantProfileRow[]>(Prisma.sql`
      SELECT
        profile."userId" AS "userId",
        handle."handle" AS "handle",
        profile."displayName" AS "displayName",
        profile."avatarUrl" AS "avatarUrl"
      FROM "public_profile" AS profile
      INNER JOIN "handle" AS handle
        ON handle."id" = profile."handleId"
      WHERE
        profile."userId" IN (${Prisma.join(userIds)})
        AND handle."kind" = 'USER'
        AND handle."status" = 'ACTIVE'
    `);
    return new Map(
      rows.map((row) => [
        row.userId,
        {
          userId: row.userId,
          handle: row.handle,
          name: row.displayName,
          avatarUrl: row.avatarUrl,
        },
      ]),
    );
  }

  private async toView(
    conversation: ConversationRecord,
    actorUserId: string,
  ): Promise<DirectConversationView> {
    const peer = conversation.members.find(
      (member) => member.userId !== actorUserId,
    );
    if (!peer) {
      throw new DirectChatError(
        "NOT_FOUND",
        "Direct Chat was not found",
      );
    }
    const [unreadCount, profiles, blockedByMe] =
      await Promise.all([
        this.readUnreadCount(
          actorUserId,
          conversation.id,
        ),
        this.readParticipantProfiles(
          conversation.members.map(
            (member) => member.userId,
          ),
        ),
        this.trust.hasBlocked(
          actorUserId,
          peer.userId,
        ),
      ]);
    const summary = this.toSummary(
      conversation,
      actorUserId,
      unreadCount,
      profiles,
      blockedByMe,
    );
    const devices = conversation.members.flatMap((member) =>
      member.user.cryptoDevices.filter((device) => device.revokedAt === null).map(toDeviceView),
    );
    return {
      ...summary,
      members: conversation.members.map((member) =>
        requireParticipant(profiles, member.userId),
      ),
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
    profiles: ReadonlyMap<string, DirectParticipant>,
    blockedByMe: boolean,
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
      peer: requireParticipant(profiles, peer.userId),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount,
      lastKind: isKind(latest?.kind) ? latest.kind : null,
      lastSenderUserId: latest?.senderUserId ?? null,
      createdAt: conversation.createdAt.toISOString(),
      interactionEpoch: conversation.interactionEpoch,
      blockedByMe,
      privacy: toPrivacy(mine, peer),
    };
  }
}

const conversationInclude = {
  surface: true,
  members: {
    include: {
      user: {
        select: {
          id: true,
          cryptoDevices: true,
        },
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

function requireParticipant(
  profiles: ReadonlyMap<string, DirectParticipant>,
  userId: string,
): DirectParticipant {
  const participant = profiles.get(userId);
  if (!participant) {
    throw new Error("Direct Chat participant public identity is invalid");
  }
  return participant;
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
    interactionEpoch: number;
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
    interactionEpoch: row.interactionEpoch,
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
