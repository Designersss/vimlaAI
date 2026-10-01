import type { PrismaClient } from "@vimla/database";
import type {
  ResolveSurfaceAuthorityInput,
  ResolvedSurfaceAuthority,
  SurfaceAuthorityAdapter,
} from "./surface-authority.js";

export class DirectChatSurfaceAuthorityAdapter
  implements SurfaceAuthorityAdapter
{
  readonly kind = "DIRECT" as const;

  constructor(private readonly db: PrismaClient) {}

  async resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<ResolvedSurfaceAuthority | null> {
    const surface =
      await this.db.communicationSurface.findFirst({
        where: {
          id: input.surfaceId,
          kind: "DIRECT",
        },
        select: {
          directConversation: {
            select: {
              id: true,
              members: {
                select: { userId: true },
                orderBy: { userId: "asc" },
              },
            },
          },
        },
      });
    const conversation =
      surface?.directConversation;
    if (!conversation) return null;

    const audienceUserIds =
      conversation.members.map(
        (member) => member.userId,
      );
    const canRead =
      audienceUserIds.includes(input.actorUserId);

    return {
      surfaceId: input.surfaceId,
      kind: "DIRECT",
      domainId: conversation.id,
      actorUserId: input.actorUserId,
      canRead,
      canContribute: canRead,
      audienceUserIds,
      eligibleReadScopes: [
        {
          kind: "DIRECT_CHAT",
          directConversationId: conversation.id,
        },
        {
          kind: "PROJECT",
          projectId: "ANY_AUTHORIZED",
        },
      ],
      eligibleWriteScopes: [
        {
          kind: "DIRECT_CHAT",
          directConversationId: conversation.id,
          explicitActionRequired: false,
        },
      ],
      disclosurePolicy: {
        serverPlaintextAvailable: false,
        clientDisclosureRequired: true,
        peerContentRequiresConsent: true,
      },
      capabilities: canRead
        ? [
            "CONTEXT_READ",
            "CONTEXT_CONTRIBUTE",
            "AI_INVOKE",
            "ACTION_INVOKE",
          ]
        : [],
    };
  }
}
