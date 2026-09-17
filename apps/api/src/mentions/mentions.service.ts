import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  MentionCandidate,
  MentionSuggestionsQuery,
  MentionSuggestionsResponse,
} from "@vimla/contracts";
import { PrismaService } from "../persistence/prisma.service.js";
import { TextChatService } from "../ai/text-chat.service.js";

type ContextPerson = { userId: string; role: string | null };

@Injectable()
export class MentionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TextChatService) private readonly chat: TextChatService,
  ) {}

  async suggest(userId: string, query: MentionSuggestionsQuery): Promise<MentionSuggestionsResponse> {
    const [people, systemRows, models] = await Promise.all([
      this.contextPeople(userId, query),
      this.prisma.client.handle.findMany({
        where: { normalized: { in: ["vimla", "auto"] }, status: "ACTIVE" },
        select: { id: true, normalized: true },
      }),
      this.chat.listRetailModels(),
    ]);

    const peopleCandidates = await this.peopleCandidates(people);
    const systemByHandle = new Map(systemRows.map((row) => [row.normalized, row]));
    const vimlaRow = systemByHandle.get("vimla");
    const autoRow = systemByHandle.get("auto");

    const modelHandles = await this.prisma.client.handle.findMany({
      where: {
        normalized: { in: models.map((model) => model.slug) },
        kind: "AI_MODEL",
        status: "ACTIVE",
      },
      select: { id: true, normalized: true },
    });
    const modelHandleBySlug = new Map(modelHandles.map((row) => [row.normalized, row]));

    const vimlaCandidates: MentionCandidate[] = vimlaRow
      ? [
          {
            id: vimlaRow.id,
            kind: "SYSTEM_AGENT",
            handle: "vimla",
            label: "Vimla",
            description: null,
            avatarUrl: null,
            role: null,
          },
        ]
      : [];

    const aiCandidates: MentionCandidate[] = [];
    if (autoRow) {
      aiCandidates.push({
        id: autoRow.id,
        kind: "AI_AUTO",
        handle: "auto",
        label: "Auto",
        description: null,
        avatarUrl: null,
        role: null,
      });
    }
    for (const model of models) {
      const handle = modelHandleBySlug.get(model.slug);
      if (!handle) continue;
      aiCandidates.push({
        id: handle.id,
        kind: "AI_MODEL",
        handle: handle.normalized,
        label: model.displayName,
        description: model.vendor,
        avatarUrl: null,
        role: null,
      });
    }

    return {
      people: this.filterAndRank(peopleCandidates, query.q),
      vimla: this.filterAndRank(vimlaCandidates, query.q),
      ai: this.filterAndRank(aiCandidates, query.q, true),
    };
  }

  private async contextPeople(userId: string, query: MentionSuggestionsQuery): Promise<ContextPerson[]> {
    if (query.conversationId) {
      const conversation = await this.prisma.client.conversation.findFirst({
        where: { id: query.conversationId, userId },
        select: { userId: true },
      });
      if (!conversation) throw new NotFoundException("Mention context was not found");
      return [{ userId: conversation.userId, role: null }];
    }

    if (query.projectId) {
      const project = await this.prisma.client.project.findUnique({
        where: { id: query.projectId },
        select: {
          ownerUserId: true,
          members: { select: { userId: true, role: true } },
        },
      });
      if (!project) throw new NotFoundException("Mention context was not found");
      const isMember = project.members.some((member) => member.userId === userId);
      if (project.ownerUserId !== userId && !isMember) {
        throw new NotFoundException("Mention context was not found");
      }
      return [
        { userId: project.ownerUserId, role: "OWNER" },
        ...project.members.map((member) => ({ userId: member.userId, role: member.role })),
      ];
    }

    if (query.directConversationId) {
      const members = await this.prisma.client.directConversationMember.findMany({
        where: { conversationId: query.directConversationId },
        select: { userId: true },
      });
      if (!members.some((member) => member.userId === userId)) {
        throw new NotFoundException("Mention context was not found");
      }
      return members.map((member) => ({ userId: member.userId, role: null }));
    }

    return [];
  }

  private async peopleCandidates(people: ContextPerson[]): Promise<MentionCandidate[]> {
    const unique = new Map(people.map((person) => [person.userId, person]));
    const userIds = [...unique.keys()];
    if (userIds.length === 0) return [];

    const [handles, users] = await Promise.all([
      this.prisma.client.handle.findMany({
        where: { userId: { in: userIds }, kind: "USER", status: "ACTIVE" },
        select: { id: true, handle: true, userId: true },
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));

    return handles.flatMap((handle) => {
      if (!handle.userId) return [];
      const user = userById.get(handle.userId);
      if (!user) return [];
      return [
        {
          id: handle.id,
          kind: "USER" as const,
          handle: handle.handle,
          label: user.name,
          description: null,
          avatarUrl: user.image,
          role: unique.get(handle.userId)?.role ?? null,
        },
      ];
    });
  }

  private filterAndRank(
    candidates: MentionCandidate[],
    query: string,
    autoFirst = false,
  ): MentionCandidate[] {
    const q = query.toLowerCase();
    if (!q) {
      return [...candidates].sort((left, right) => {
        if (autoFirst && left.kind === "AI_AUTO") return -1;
        if (autoFirst && right.kind === "AI_AUTO") return 1;
        return left.label.localeCompare(right.label);
      });
    }

    return candidates
      .map((candidate) => ({ candidate, rank: this.rank(candidate, q) }))
      .filter((entry) => entry.rank < Number.POSITIVE_INFINITY)
      .sort((left, right) => left.rank - right.rank || left.candidate.label.localeCompare(right.candidate.label))
      .map((entry) => entry.candidate);
  }

  private rank(candidate: MentionCandidate, query: string): number {
    if (candidate.handle === query) return 0;
    if (candidate.kind === "USER" && candidate.handle.startsWith(query)) return 1;
    if (candidate.kind === "USER" && candidate.label.toLowerCase().includes(query)) return 2;
    if (
      (candidate.kind === "SYSTEM_AGENT" || candidate.kind === "AI_AUTO") &&
      (candidate.handle.includes(query) || candidate.label.toLowerCase().includes(query))
    ) {
      return 3;
    }
    if (
      candidate.kind === "AI_MODEL" &&
      (candidate.handle.includes(query) || candidate.label.toLowerCase().includes(query))
    ) {
      return 4;
    }
    return Number.POSITIVE_INFINITY;
  }
}
