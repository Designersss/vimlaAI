import type { PrismaClient } from "@vimla/database";
import type {
  ResolveSurfaceAuthorityInput,
  ResolvedSurfaceAuthority,
  SurfaceAuthorityAdapter,
} from "./surface-authority.js";

export class AiThreadSurfaceAuthorityAdapter
  implements SurfaceAuthorityAdapter
{
  readonly kind = "AI_THREAD" as const;

  constructor(private readonly db: PrismaClient) {}

  async resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<ResolvedSurfaceAuthority | null> {
    const surface =
      await this.db.communicationSurface.findFirst({
        where: {
          id: input.surfaceId,
          kind: "AI_THREAD",
        },
        select: {
          conversation: {
            select: {
              id: true,
              userId: true,
              kind: true,
            },
          },
        },
      });
    const conversation = surface?.conversation;
    if (
      !conversation ||
      conversation.kind !== "CHAT"
    ) {
      return null;
    }

    const canRead =
      conversation.userId === input.actorUserId;
    return {
      surfaceId: input.surfaceId,
      kind: "AI_THREAD",
      domainId: conversation.id,
      actorUserId: input.actorUserId,
      canRead,
      canContribute: canRead,
      audienceUserIds: [conversation.userId],
      eligibleReadScopes: canRead
        ? [
            {
              kind: "PERSONAL",
              ownerUserId: conversation.userId,
            },
            {
              kind: "PROJECT",
              projectId: "ANY_AUTHORIZED",
            },
          ]
        : [],
      eligibleWriteScopes: canRead
        ? [
            {
              kind: "PERSONAL",
              ownerUserId: conversation.userId,
              explicitActionRequired: false,
            },
            {
              kind: "PROJECT",
              projectId: "ANY_AUTHORIZED",
              explicitActionRequired: true,
            },
          ]
        : [],
      disclosurePolicy: {
        serverPlaintextAvailable: true,
        clientDisclosureRequired: false,
        peerContentRequiresConsent: false,
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
