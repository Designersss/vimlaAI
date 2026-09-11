import type { ProjectMemberRole } from "@vimla/contracts";

export interface ActorContext {
  userId: string;
  email: string;
}

export interface RankableProject {
  id: string;
  lastOpenedAt: Date | null;
  createdAt: Date;
}

export interface RankableMember {
  userId: string;
  role: ProjectMemberRole;
  lastOpenedAt: Date | null;
  createdAt: Date;
}

export interface ProjectServiceOptions {
  tokenSecret: string;
  webOrigin: string;
  inviteTtlDays: number;
}
