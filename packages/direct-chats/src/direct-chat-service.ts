import type { Prisma } from "@vimla/database";
import {
  DIRECT_CHAT_LIMITS,
  type CreateDirectConversation,
  type DirectConversationPrivacy,
  type DirectConversationSummary,
  type DirectConversationView,
  type DirectEnvelopeView,
  type DirectMessageView,
  type DirectParticipant,
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

  async list(actor: ActorContext, query: { limit: number; cursor?: string }): Promise<{
    items: DirectConversationSummary[];
    nextCursor: string | null;
  }> {
    const cursor = decodeCursor(query.cursor);
    const memberships = await this.db.directConversationMember.findMany({
      where: {
        userId: actor.userId,
        ...(cursor
          ? {
              conversation: {
                OR: [
                  { lastMessageAt: { lt: cursor.at } },
                  { AND: [{ lastMessageAt: cursor.at }, { id: { lt: cursor.id } }] },
                ],
              },
            }
          : {}),
      },
      include: { conversation: { include: conversationInclude } },
      orderBy: [{ conversation: { lastMessageAt: "desc" } }, { conversation: { id: "desc" } }],
      take: query.limit + 1,
    });
    const page = memberships.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toSummary(row.conversation, actor.userId)),
      nextCursor:
        memberships.length > query.limit && last
          ? encodeCursor(last.conversation.lastMessageAt, last.conversation.id)
          : null,
    };
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

  async markRead(actor: ActorContext, conversationId: string): Promise<DirectConversationView> {
    const conversation = await this.requireMemberConversation(actor.userId, conversationId);
    const latest = conversation.messages[0];
    await this.db.directConversationMember.update({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      data: {
        lastReadAt: new Date(),
        lastReadMessageCreatedAt: latest?.createdAt ?? new Date(),
      },
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

  async send(
    actor: ActorContext,
    conversationId: string,
    input: SendDirectMessage,
    resolvedMentions: MessageMentionView[] = [],
  ): Promise<DirectMessageView> {
    const conversation = await this.requireMemberConversation(actor.userId, conversationId);
    const existing = await this.db.directMessage.findUnique({
      where: {
        conversationId_senderUserId_clientMessageId: {
          conversationId,
          senderUserId: actor.userId,
          clientMessageId: input.clientMessageId,
        },
      },
      include: { envelopes: true },
    });
    if (existing) {
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
        !sameReplayEnvelopes(existing.envelopes, input.envelopes) ||
        !sameReplayMentions(existingMentions, input.mentions)
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

    const senderDevice = await this.requireActiveDevice(actor.userId, input.senderDeviceId);
    if (input.envelopes.length > this.options.maxEnvelopes) {
      throw new DirectChatError("VALIDATION_ERROR", "Too many envelopes");
    }

    const memberIds = conversation.members.map((member) => member.userId);
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
        await tx.directConversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: message.createdAt },
        });
        return message;
      });
      return toMessageView(created, senderDevice.id, resolvedMentions);
    } catch (error: unknown) {
      if (isUnique(error)) {
        const replay = await this.db.directMessage.findUnique({
          where: {
            conversationId_senderUserId_clientMessageId: {
              conversationId,
              senderUserId: actor.userId,
              clientMessageId: input.clientMessageId,
            },
          },
          include: { envelopes: { where: { recipientDeviceId: senderDevice.id } } },
        });
        if (replay) {
          const mentions = await this.readMentionMap([replay.id]);
          return toMessageView(replay, senderDevice.id, mentions.get(replay.id) ?? []);
        }
        throw new DirectChatError("TAMPERED", "Message envelope was rejected");
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
      where: { id: deviceId, userId, revokedAt: null },
    });
    if (!device) {
      throw new DirectChatError("NOT_FOUND", "Device was not found");
    }
    return device;
  }

  private toView(conversation: ConversationRecord, actorUserId: string): DirectConversationView {
    const summary = this.toSummary(conversation, actorUserId);
    const devices = conversation.members.flatMap((member) =>
      member.user.cryptoDevices.filter((device) => device.revokedAt === null).map(toDeviceView),
    );
    return {
      ...summary,
      members: conversation.members.map((member) => toParticipant(member.user)),
      devices,
    };
  }

  private toSummary(conversation: ConversationRecord, actorUserId: string): DirectConversationSummary {
    const mine = conversation.members.find((member) => member.userId === actorUserId);
    const peer = conversation.members.find((member) => member.userId !== actorUserId);
    if (!mine || !peer) {
      throw new DirectChatError("NOT_FOUND", "Direct Chat was not found");
    }
    const unreadCount = conversation.messages.filter((message) => {
      if (message.senderUserId === actorUserId) {
        return false;
      }
      if (!mine.lastReadMessageCreatedAt) {
        return true;
      }
      return message.createdAt > mine.lastReadMessageCreatedAt;
    }).length;
    const latest = conversation.messages[0];
    return {
      id: conversation.id,
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
  members: {
    include: {
      user: {
        include: { cryptoDevices: true },
      },
    },
  },
  messages: { orderBy: { createdAt: "desc" as const }, take: 50 },
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
  incoming: readonly SendDirectMessage["mentions"],
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
  return [...stored]
    .map(canonical)
    .sort()
    .every(
      (value, index) =>
        value ===
        [...incoming].map(canonical).sort()[index],
    );
}


function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
