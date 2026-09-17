import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ChatMessageRoute,
  MessageMentionInput,
  MessageMentionView,
} from "@vimla/contracts";
import { Prisma } from "@vimla/database";
import { PrismaService } from "../persistence/prisma.service.js";

export type ResolvedChatMention = MessageMentionView;

type PersistedRoutingResult = {
  messageId: string;
  route: ChatMessageRoute;
  mentions: MessageMentionView[];
};

@Injectable()
export class ChatMentionRoutingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(input: {
    userId: string;
    content: string;
    mentions: MessageMentionInput[];
  }): Promise<ResolvedChatMention[]> {
    return this.resolveMentions(input);
  }

  routeFor(mentions: Array<Pick<MessageMentionView, "kind">>): ChatMessageRoute {
    return mentions.some((mention) => mention.kind !== "USER") ? "ORCHESTRATION" : "CHAT";
  }

  async persist(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    content: string;
    mentions: MessageMentionInput[];
    resolvedMentions?: ResolvedChatMention[];
  }): Promise<PersistedRoutingResult> {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId, kind: "CHAT" },
      select: { id: true, userId: true },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found");
    }

    const resolved = input.resolvedMentions ?? await this.resolveMentions({
      userId: input.userId,
      content: input.content,
      mentions: input.mentions,
    });
    const route = this.routeFor(resolved);
    const messageId = randomUUID();

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.message.create({
          data: {
            id: messageId,
            conversationId: conversation.id,
            role: "USER",
            content: input.content,
            status: "COMPLETE",
          },
        });

        if (resolved.length > 0) {
          await tx.messageMention.createMany({
            data: resolved.map((mention) => ({
              id: mention.id,
              messageId,
              handleId: mention.handleId,
              kind: mention.kind,
              targetId: mention.targetId,
              canonicalHandle: mention.canonicalHandle,
              startOffset: mention.startOffset,
              endOffset: mention.endOffset,
            })),
          });
        }

        await tx.chatMessageSubmission.create({
          data: {
            userId: input.userId,
            conversationId: conversation.id,
            clientRequestId: input.clientRequestId,
            messageId,
          },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            updatedAt: new Date(),
            title: titleFrom(input.content),
          },
        });
      });
      return { messageId, route, mentions: resolved };
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }

    const replay = await this.prisma.client.chatMessageSubmission.findUnique({
      where: {
        userId_clientRequestId: {
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        },
      },
      select: { messageId: true, conversationId: true },
    });
    if (!replay || replay.conversationId !== conversation.id) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Message request could not be replayed",
      });
    }

    const mentions = await this.readForMessage(replay.messageId);
    return {
      messageId: replay.messageId,
      route: this.routeFor(mentions),
      mentions,
    };
  }

  async readForMessages(messageIds: string[]): Promise<Map<string, MessageMentionView[]>> {
    const grouped = new Map<string, MessageMentionView[]>();
    if (messageIds.length === 0) return grouped;

    const rows = await this.prisma.client.messageMention.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: [{ messageId: "asc" }, { startOffset: "asc" }],
    });
    for (const row of rows) {
      const current = grouped.get(row.messageId) ?? [];
      current.push(toView(row));
      grouped.set(row.messageId, current);
    }
    return grouped;
  }

  private async readForMessage(messageId: string): Promise<MessageMentionView[]> {
    const rows = await this.prisma.client.messageMention.findMany({
      where: { messageId },
      orderBy: { startOffset: "asc" },
    });
    return rows.map(toView);
  }

  private async resolveMentions(input: {
    userId: string;
    content: string;
    mentions: MessageMentionInput[];
  }): Promise<ResolvedChatMention[]> {
    const ordered = [...input.mentions].sort((left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous && current && current.startOffset < previous.endOffset) {
        throw invalidMention("Mention ranges cannot overlap");
      }
    }

    const ids = [...new Set(ordered.map((mention) => mention.handleId))];
    const handles = ids.length === 0
      ? []
      : await this.prisma.client.handle.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            handle: true,
            normalized: true,
            kind: true,
            status: true,
            userId: true,
            aiModelId: true,
            systemKey: true,
          },
        });
    const handleById = new Map(handles.map((handle) => [handle.id, handle]));

    const modelIds = handles.flatMap((handle) => handle.aiModelId ? [handle.aiModelId] : []);
    const now = new Date();
    const models = modelIds.length === 0
      ? []
      : await this.prisma.client.aiModel.findMany({
          where: { id: { in: modelIds }, active: true, visible: true },
          select: { id: true, priceVersions: true },
        });
    const invocableModels = new Set(
      models
        .filter((model) =>
          model.priceVersions.some(
            (version) =>
              version.effectiveFrom <= now &&
              (version.effectiveTo === null || version.effectiveTo > now),
          ),
        )
        .map((model) => model.id),
    );

    return ordered.map((mention) => {
      const handle = handleById.get(mention.handleId);
      if (!handle || handle.status !== "ACTIVE") {
        throw invalidMention("Mention target is not active");
      }
      if (handle.normalized !== mention.canonicalHandle || handle.handle !== mention.canonicalHandle) {
        throw invalidMention("Mention handle is stale");
      }
      if (!matchesToken(input.content, mention)) {
        throw invalidMention("Mention range does not match message text");
      }

      const resolvedKind = kindForHandle(handle);
      if (!resolvedKind || resolvedKind !== mention.kind) {
        throw invalidMention("Mention kind does not match the registry");
      }

      let targetId: string | null = null;
      if (resolvedKind === "USER") {
        if (!handle.userId || handle.userId !== input.userId) {
          throw invalidMention("Mentioned user is outside this conversation scope");
        }
        targetId = handle.userId;
      } else if (resolvedKind === "AI_MODEL") {
        if (!handle.aiModelId || !invocableModels.has(handle.aiModelId)) {
          throw invalidMention("Mentioned model is not currently invocable");
        }
        targetId = handle.aiModelId;
      } else {
        if (!handle.systemKey) {
          throw invalidMention("Mentioned system target is invalid");
        }
        targetId = handle.systemKey;
      }

      return {
        id: randomUUID(),
        handleId: handle.id,
        kind: resolvedKind,
        targetId,
        canonicalHandle: handle.normalized,
        startOffset: mention.startOffset,
        endOffset: mention.endOffset,
      };
    });
  }
}

function kindForHandle(handle: {
  kind: string;
  userId: string | null;
  aiModelId: string | null;
  systemKey: string | null;
}): MessageMentionInput["kind"] | null {
  if (handle.kind === "USER" && handle.userId) return "USER";
  if (handle.kind === "AI_MODEL" && handle.aiModelId) return "AI_MODEL";
  if (handle.kind === "SYSTEM_AGENT" && handle.systemKey === "VIMLA") return "SYSTEM_AGENT";
  if (handle.kind === "SYSTEM_AGENT" && handle.systemKey === "AI_AUTO") return "AI_AUTO";
  return null;
}

function matchesToken(content: string, mention: MessageMentionInput): boolean {
  const token = `@${mention.canonicalHandle}`;
  if (content.slice(mention.startOffset, mention.endOffset) !== token) return false;
  const before = mention.startOffset > 0 ? content[mention.startOffset - 1] ?? "" : "";
  const after = content[mention.endOffset] ?? "";
  const handleCharacter = /[A-Za-z0-9._-]/;
  return !handleCharacter.test(before) && !handleCharacter.test(after);
}

function toView(row: {
  id: string;
  handleId: string;
  kind: string;
  targetId: string | null;
  canonicalHandle: string;
  startOffset: number;
  endOffset: number;
}): MessageMentionView {
  if (
    row.kind !== "USER" &&
    row.kind !== "SYSTEM_AGENT" &&
    row.kind !== "AI_AUTO" &&
    row.kind !== "AI_MODEL"
  ) {
    throw invalidMention("Persisted mention kind is invalid");
  }
  return {
    id: row.id,
    handleId: row.handleId,
    kind: row.kind,
    targetId: row.targetId,
    canonicalHandle: row.canonicalHandle,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
  };
}

function invalidMention(message: string): BadRequestException {
  return new BadRequestException({ code: "validation_error", message });
}

function titleFrom(content: string): string {
  const line = content.trim().split("\n")[0] ?? "New chat";
  return line.slice(0, 80);
}
