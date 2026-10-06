import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@vimla/database";
import {
  PrismaUserTrustPolicy,
  trustDiscoveryAllowedSql,
} from "@vimla/trust";
import { PrismaService } from "../persistence/prisma.service.js";

export const PEOPLE_ACCESS_POLICY = Symbol("PEOPLE_ACCESS_POLICY");

export interface PeopleAccessPolicy {
  canDiscover(actorUserId: string, targetUserId: string): Promise<boolean>;
  filterDiscoverableUserIds(
    actorUserId: string,
    candidateUserIds: readonly string[],
  ): Promise<readonly string[]>;
  discoveryAllowedSql(
    actorUserId: string,
    candidateUserId: Prisma.Sql,
  ): Prisma.Sql;
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

  canDiscover(
    actorUserId: string,
    targetUserId: string,
  ): Promise<boolean> {
    return this.trust.canDiscover(actorUserId, targetUserId);
  }

  filterDiscoverableUserIds(
    actorUserId: string,
    candidateUserIds: readonly string[],
  ): Promise<readonly string[]> {
    return this.trust.filterDiscoverableUserIds(
      actorUserId,
      candidateUserIds,
    );
  }

  discoveryAllowedSql(
    actorUserId: string,
    candidateUserId: Prisma.Sql,
  ): Prisma.Sql {
    return trustDiscoveryAllowedSql(
      actorUserId,
      candidateUserId,
    );
  }

  canStartDirectChat(actorUserId: string, targetUserId: string): Promise<boolean> {
    return this.trust.canInteract(actorUserId, targetUserId);
  }
}
