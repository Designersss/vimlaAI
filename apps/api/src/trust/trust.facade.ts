import { Inject, Injectable } from "@nestjs/common";
import { createSurfaceAuthorityRegistry } from "@vimla/context";
import { TrustService } from "@vimla/trust";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class TrustFacade {
  readonly service: TrustService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
  ) {
    const surfaceAuthority = createSurfaceAuthorityRegistry(
      prisma.client,
    );
    this.service = new TrustService(prisma.client, {
      canReadSurface: async (actorUserId, surfaceId) => {
        try {
          const authority = await surfaceAuthority.resolve({
            actorUserId,
            surfaceId,
          });
          return authority.canRead;
        } catch {
          return false;
        }
      },
    });
  }
}
