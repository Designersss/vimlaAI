import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DIRECT_CHAT_LIMITS,
  type DirectMessageKind,
  type MessageMentionInput,
  type MessageMentionView,
} from "@vimla/contracts";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class DirectMentionRoutingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  assertMessageKind(kind: DirectMessageKind, mentions: MessageMentionView[]): void {
    const hasVimlaInvocation = mentions.some(
      (mention) =>
        mention.kind === "SYSTEM_AGENT" &&
        mention.targetId === "VIMLA" &&
        mention.canonicalHandle === "vimla",
    );

    if (kind === "OPERATOR_INVOKE" && !hasVimlaInvocation) {
      throw invalidMention("Direct Chat operator invocation requires a structured @vimla mention");
    }
    if (kind === "HUMAN" && hasVimlaInvocation) {
      throw invalidMention("Structured @vimla mention must use the operator invocation route");
    }
  }

  async resolve(input: {
    userId: string;
    conversationId: string;
    mentions: MessageMentionInput[];
  }): Promise<MessageMentionView[]> {
    const ordered = [...input.mentions].sort((left, right) =>
      left.startOffset - right.startOffset || left.endOffset - right.endOffset,
    );
    for (const mention of ordered) {
      if (mention.endOffset > DIRECT_CHAT_LIMITS.ciphertextMax) {
        throw invalidMention("Mention range is outside the encrypted message bounds");
      }
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous && current && current.startOffset < previous.endOffset) {
        throw invalidMention("Mention ranges cannot overlap");
      }
    }

    const members = await this.prisma.client.directConversationMember.findMany({
      where: { conversationId: input.conversationId },
      select: { userId: true },
    });
    if (!members.some((member) => member.userId === input.userId)) {
      throw new NotFoundException("Direct Chat was not found");
    }
    const memberIds = new Set(members.map((member) => member.userId));

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

      const resolvedKind = kindForHandle(handle);
      if (!resolvedKind || resolvedKind !== mention.kind) {
        throw invalidMention("Mention kind does not match the registry");
      }

      let targetId: string | null = null;
      if (resolvedKind === "USER") {
        if (!handle.userId || !memberIds.has(handle.userId)) {
          throw invalidMention("Mentioned user is outside this Direct Chat");
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

function invalidMention(message: string): BadRequestException {
  return new BadRequestException({ code: "validation_error", message });
}
