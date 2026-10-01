import type {
  CommunicationSurfaceKind,
} from "@vimla/contracts";
import type { PrismaClient } from "@vimla/database";
import { AiThreadSurfaceAuthorityAdapter } from "./ai-thread-authority.js";
import { DirectChatSurfaceAuthorityAdapter } from "./direct-chat-authority.js";
import {
  SurfaceAuthorityRegistry,
  type SurfaceIdentity,
  type SurfaceIdentityResolver,
} from "./surface-authority.js";

export class DatabaseSurfaceIdentityResolver
  implements SurfaceIdentityResolver
{
  constructor(private readonly db: PrismaClient) {}

  async resolve(
    surfaceId: string,
  ): Promise<SurfaceIdentity | null> {
    const surface =
      await this.db.communicationSurface.findUnique({
        where: { id: surfaceId },
        select: { id: true, kind: true },
      });
    if (!surface) return null;
    const kind = knownSurfaceKind(surface.kind);
    return kind
      ? { surfaceId: surface.id, kind }
      : null;
  }
}

export function createSurfaceAuthorityRegistry(
  db: PrismaClient,
): SurfaceAuthorityRegistry {
  return new SurfaceAuthorityRegistry(
    new DatabaseSurfaceIdentityResolver(db),
    [
      new AiThreadSurfaceAuthorityAdapter(db),
      new DirectChatSurfaceAuthorityAdapter(db),
    ],
  );
}

function knownSurfaceKind(
  value: string,
): CommunicationSurfaceKind | null {
  return value === "AI_THREAD" || value === "DIRECT"
    ? value
    : null;
}
