import type { CountLimit } from "@vimla/billing";
import type { ProjectAccessState, ProjectMemberRole } from "@vimla/contracts";
import type { RankableMember, RankableProject } from "./types.js";

interface ActivityKey {
  key: string;
  lastOpenedAt: Date | null;
  createdAt: Date;
}

export function compareLastOpened(left: ActivityKey, right: ActivityKey): number {
  const leftOpened = left.lastOpenedAt?.getTime() ?? 0;
  const rightOpened = right.lastOpenedAt?.getTime() ?? 0;
  if (leftOpened !== rightOpened) {
    return rightOpened - leftOpened;
  }
  const created = right.createdAt.getTime() - left.createdAt.getTime();
  if (created !== 0) {
    return created;
  }
  return right.key.localeCompare(left.key);
}

export function selectActiveIds(items: readonly RankableProject[], limit: CountLimit): Set<string> {
  if (limit.unlimited) {
    return new Set(items.map((item) => item.id));
  }
  const ranked = [...items]
    .map((item) => ({ ...item, key: item.id }))
    .sort(compareLastOpened);
  const max = Number(limit.value);
  return new Set(ranked.slice(0, Math.max(0, max)).map((item) => item.id));
}

export function lockedOwnedProjectIds(owned: readonly RankableProject[], ownedActiveMax: CountLimit): Set<string> {
  const active = selectActiveIds(owned, ownedActiveMax);
  return new Set(owned.filter((item) => !active.has(item.id)).map((item) => item.id));
}

export function lockedExternalProjectIds(
  memberships: readonly RankableProject[],
  externalActiveMax: CountLimit,
): Set<string> {
  const active = selectActiveIds(memberships, externalActiveMax);
  return new Set(memberships.filter((item) => !active.has(item.id)).map((item) => item.id));
}

export function activeMemberUserIds(
  members: readonly RankableMember[],
  membersPerOwnedProjectMax: CountLimit,
): Set<string> {
  const owner = members.find((member) => member.role === "OWNER");
  if (membersPerOwnedProjectMax.unlimited) {
    return new Set(members.map((member) => member.userId));
  }
  const max = Number(membersPerOwnedProjectMax.value);
  const selected = new Set<string>();
  if (owner) {
    selected.add(owner.userId);
  }
  const others = members
    .filter((member) => member.role !== "OWNER")
    .map((member) => ({ ...member, key: member.userId }))
    .sort(compareLastOpened)
    .map((member) => member.userId);
  for (const userId of others) {
    if (selected.size >= max) {
      break;
    }
    selected.add(userId);
  }
  return selected;
}

export function viewerAccessState(input: {
  isOwner: boolean;
  projectLocked: boolean;
  memberLockedByOwnerPlan: boolean;
  memberLockedByMemberPlan: boolean;
}): ProjectAccessState {
  if (input.projectLocked) {
    return "PLAN_LOCKED";
  }
  if (input.memberLockedByOwnerPlan) {
    return "READ_ONLY_BY_OWNER_PLAN";
  }
  if (!input.isOwner && input.memberLockedByMemberPlan) {
    return "READ_ONLY_BY_MEMBER_PLAN";
  }
  return "ACTIVE";
}

export function isEntitlementReadOnly(state: ProjectAccessState): boolean {
  return state !== "ACTIVE";
}

export function canEditWithRole(role: ProjectMemberRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageMembersWithRole(role: ProjectMemberRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
