import { Injectable } from "@nestjs/common";

export const PEOPLE_ACCESS_POLICY = Symbol("PEOPLE_ACCESS_POLICY");

export interface PeopleAccessPolicy {
  excludedDiscoveryUserIds(actorUserId: string): Promise<readonly string[]>;
  canStartDirectChat(actorUserId: string, targetUserId: string): Promise<boolean>;
}

@Injectable()
export class DefaultPeopleAccessPolicy implements PeopleAccessPolicy {
  async excludedDiscoveryUserIds(): Promise<readonly string[]> {
    return [];
  }

  async canStartDirectChat(): Promise<boolean> {
    return true;
  }
}
