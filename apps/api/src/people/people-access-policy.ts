import { Inject, Injectable } from "@nestjs/common";
import { PrismaUserTrustPolicy } from "@vimla/trust";
import { PrismaService } from "../persistence/prisma.service.js";

export const PEOPLE_ACCESS_POLICY = Symbol("PEOPLE_ACCESS_POLICY");

export interface PeopleAccessPolicy {
  excludedDiscoveryUserIds(actorUserId: string): Promise<readonly string[]>;
  canStartDirectChat(actorUserId: string, targetUserId: string): Promise<boolean>;
}

@Injectable()
export class DefaultPeopleAccessPolicy implements PeopleAccessPolicy {
  private readonly trust: PrismaUserTrustPolicy;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
  ) {
    this.trust = new PrismaUserTrustPolicy(prisma.client);
  }

  excludedDiscoveryUserIds(actorUserId: string): Promise<readonly string[]> {
    return this.trust.excludedDiscoveryUserIds(actorUserId);
  }

  canStartDirectChat(actorUserId: string, targetUserId: string): Promise<boolean> {
    return this.trust.canInteract(actorUserId, targetUserId);
  }
}
