import {
  REALTIME_PROTOCOL_VERSION,
  directMessageCreatedRealtimeEventSchema,
} from "@vimla/contracts";
import type { Prisma } from "@vimla/database";

export interface DirectMessageCreatedEventInput {
  conversationId: string;
  messageId: string;
  occurredAt: Date;
  recipientUserIds: readonly string[];
}

export interface DirectChatDurableEventWriter {
  directMessageCreated(
    tx: Prisma.TransactionClient,
    input: DirectMessageCreatedEventInput,
  ): Promise<void>;
}

export class PrismaDirectChatDurableEventWriter
  implements DirectChatDurableEventWriter
{
  async directMessageCreated(
    tx: Prisma.TransactionClient,
    input: DirectMessageCreatedEventInput,
  ): Promise<void> {
    const recipientUserIds = [
      ...new Set(input.recipientUserIds),
    ];
    if (recipientUserIds.length === 0) {
      throw new Error(
        "Durable Direct Chat event requires recipients",
      );
    }

    const event =
      directMessageCreatedRealtimeEventSchema.parse({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "EVENT",
        eventId: input.messageId,
        eventType: "DIRECT_MESSAGE_CREATED",
        durability: "DURABLE_HINT",
        scope: {
          kind: "DIRECT_CHAT",
          id: input.conversationId,
        },
        occurredAt: input.occurredAt.toISOString(),
        payload: {
          conversationId: input.conversationId,
          messageId: input.messageId,
        },
      });

    await tx.durableEvent.create({
      data: {
        id: event.eventId,
        protocolVersion: event.protocolVersion,
        eventType: event.eventType,
        durability: event.durability,
        scopeKind: event.scope.kind,
        scopeId: event.scope.id,
        occurredAt: input.occurredAt,
        payload: event.payload as Prisma.InputJsonValue,
        recipients: {
          create: recipientUserIds.map((userId) => ({
            userId,
          })),
        },
        outbox: {
          create: {},
        },
      },
    });
  }
}
