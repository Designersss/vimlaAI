import { Injectable } from "@nestjs/common";

export const PEOPLE_ACCESS_POLICY = Symbol("PEOPLE_ACCESS_POLICY");

export interface PeopleAccessPolicy {
  canDiscover(actorUserId: string, targetUserId: string): Promise<boolean>;
  canStartDirectChat(actorUserId: string, targetUserId: string): Promise<boolean>;
}

@Injectable()
export class DefaultPeopleAccessPolicy implements PeopleAccessPolicy {
  async canDiscover(): Promise<boolean> {
    return true;
  }

  async canStartDirectChat(): Promise<boolean> {
    return true;
  }
}
