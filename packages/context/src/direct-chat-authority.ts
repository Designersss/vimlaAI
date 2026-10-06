import type { PrismaClient } from "@vimla/database";
import { PrismaUserTrustPolicy } from "@vimla/trust";
import type {
  ResolveSurfaceAuthorityInput,
  ResolvedSurfaceAuthority,
  SurfaceAuthorityAdapter,
} from "./surface-authority.js";

export class DirectChatSurfaceAuthorityAdapter
  implements SurfaceAuthorityAdapter
{
  readonly kind = "DIRECT" as const;

  private readonly trust: PrismaUserTrustPolicy;

  constructor(private readonly db: PrismaClient) {
    this.trust = new PrismaUserTrustPolicy(db);
  }

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
    const peerUserId = audienceUserIds.find(
      (userId) => userId !== input.actorUserId,
    );
    const canContribute =
      canRead &&
      peerUserId !== undefined &&
      (await this.trust.canInteract(
        input.actorUserId,
        peerUserId,
      ));

    return {
      surfaceId: input.surfaceId,
      kind: "DIRECT",
      domainId: conversation.id,
      actorUserId: input.actorUserId,
      canRead,
      canContribute,
      audienceUserIds: canRead
        ? audienceUserIds
        : [],
      eligibleReadScopes: canRead
        ? [
            {
              kind: "DIRECT_CHAT",
              directConversationId: conversation.id,
            },
            {
              kind: "PROJECT",
              projectId: "ANY_AUTHORIZED",
            },
          ]
        : [],
      eligibleWriteScopes: canContribute
        ? [
            {
              kind: "DIRECT_CHAT",
              directConversationId: conversation.id,
              explicitActionRequired: false,
            },
          ]
        : [],
      disclosurePolicy: {
        serverPlaintextAvailable: false,
        clientDisclosureRequired: true,
        peerContentRequiresConsent: true,
      },
      capabilities: canRead
        ? [
            "CONTEXT_READ",
            ...(canContribute
              ? [
                  "CONTEXT_CONTRIBUTE" as const,
                  "AI_INVOKE" as const,
                  "ACTION_INVOKE" as const,
                ]
              : []),
          ]
        : [],
    };
  }
}
