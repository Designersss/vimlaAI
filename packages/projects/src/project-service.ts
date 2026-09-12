import type { Prisma, PrismaClient } from "@vimla/database";
import {
  isWithinCountLimit,
  projectEntitlementLimits,
  type CountLimit,
  type EffectivePlan,
  EffectivePlanResolver,
  type ProjectEntitlementLimits,
} from "@vimla/billing";
import {
  type CreateProject,
  type CreateProjectInvite,
  type ProjectAccessState,
  type ProjectCapabilities,
  type ProjectInviteView,
  type ProjectLockReason,
  type ProjectMemberRole,
  type ProjectMemberView,
  type ProjectSummary,
  type ProjectView,
  type UpdateProject,
} from "@vimla/contracts";
import { ProjectError } from "./errors.js";
import {
  activeMemberUserIds,
  canEditWithRole,
  canManageMembersWithRole,
  isEntitlementReadOnly,
  lockedExternalProjectIds,
  lockedOwnedProjectIds,
  viewerAccessState,
} from "./ranking.js";
import { generateInviteToken, hashInviteToken, inviteUrl, normalizeInviteEmail } from "./tokens.js";
import type { ActorContext, ProjectServiceOptions, RankableProject } from "./types.js";

type MemberRow = {
  userId: string;
  role: string;
  lastOpenedAt: Date | null;
  createdAt: Date;
  user: { id: string; email: string; name: string };
};

type ProjectRow = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: MemberRow[];
};

interface AccessSnapshot {
  project: ProjectRow;
  actorMember: MemberRow;
  viewerState: ProjectAccessState;
  projectState: "ACTIVE" | "PLAN_LOCKED";
  lockReason: ProjectLockReason;
  capabilities: ProjectCapabilities;
  ownerLimits: ProjectEntitlementLimits;
}

export class ProjectService {
  constructor(
    private readonly db: PrismaClient,
    private readonly plans: EffectivePlanResolver,
    private readonly options: ProjectServiceOptions,
  ) {}

  async create(actor: ActorContext, input: CreateProject, now = new Date()): Promise<ProjectView> {
    const created = await this.db.$transaction(async (tx) => {
      await lockQuota(tx, "project-owner", actor.userId);
      const ownerPlan = await new EffectivePlanResolver(tx).resolve(actor.userId, now);
      const limits = projectEntitlementLimits(ownerPlan.entitlements, ownerPlan.source);
      const ownedCount = await tx.project.count({ where: { ownerUserId: actor.userId } });
      if (!isWithinCountLimit(limits.ownedActiveMax, ownedCount)) {
        throw new ProjectError("OWNED_LIMIT", "Owned project limit reached for the current plan");
      }

      return tx.project.create({
        data: {
          ownerUserId: actor.userId,
          name: input.name,
          description: input.description ?? null,
          members: {
            create: {
              userId: actor.userId,
              role: "OWNER",
            },
          },
        },
        include: memberInclude,
      });
    });
    return this.toView(await this.evaluateLoaded(actor, created, now));
  }

  async list(
    actor: ActorContext,
    query: { limit: number; cursor?: string },
    now = new Date(),
  ): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
    const memberships = await this.db.projectMember.findMany({
      where: { userId: actor.userId },
      include: { project: { include: memberInclude } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const snapshots = await this.evaluateMany(
      actor,
      memberships.map((row) => row.project),
      now,
    );
    const start = decodeCursor(query.cursor);
    const ranked = snapshots.sort((left, right) => {
      const byCreated = right.project.createdAt.getTime() - left.project.createdAt.getTime();
      if (byCreated !== 0) {
        return byCreated;
      }
      return right.project.id.localeCompare(left.project.id);
    });
    const after = start ? ranked.filter((item) => isAfterCursor(item.project, start)) : ranked;
    const page = after.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((item) => this.toSummary(item)),
      nextCursor: after.length > query.limit && last ? encodeCursor(last.project) : null,
    };
  }

  async get(actor: ActorContext, projectId: string, now = new Date()): Promise<ProjectView> {
    return this.toView(await this.evaluate(actor, projectId, now));
  }

  async open(actor: ActorContext, projectId: string, now = new Date()): Promise<ProjectView> {
    await this.db.$transaction(async (tx) => {
      const membership = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actor.userId } },
      });
      if (!membership) {
        throw new ProjectError("NOT_FOUND", "Project not found");
      }
      await tx.projectMember.update({
        where: { id: membership.id },
        data: { lastOpenedAt: now },
      });
    });
    return this.toView(await this.evaluate(actor, projectId, now));
  }

  async update(actor: ActorContext, projectId: string, input: UpdateProject, now = new Date()): Promise<ProjectView> {
    const access = await this.evaluate(actor, projectId, now);
    this.assertMutable(access);
    if (!access.capabilities.canEdit) {
      throw new ProjectError("FORBIDDEN", "Not allowed to edit this project");
    }
    const updated = await this.db.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description === undefined ? undefined : input.description,
      },
      include: memberInclude,
    });
    return this.toView(await this.evaluateLoaded(actor, updated, now));
  }

  async delete(actor: ActorContext, projectId: string, now = new Date()): Promise<void> {
    const access = await this.evaluate(actor, projectId, now);
    if (!access.capabilities.canDelete) {
      throw new ProjectError("FORBIDDEN", "Only the owner can delete this project");
    }
    await this.db.project.delete({ where: { id: projectId } });
  }

  async listMembers(actor: ActorContext, projectId: string, now = new Date()): Promise<ProjectMemberView[]> {
    const access = await this.evaluate(actor, projectId, now);
    const activeMembers = activeMemberUserIds(
      access.project.members.map(toRankableMember),
      access.ownerLimits.membersPerOwnedProjectMax,
    );
    return access.project.members.map((member) =>
      toMemberView(member, memberAccessState(access, member.userId, member.role as ProjectMemberRole, activeMembers)),
    );
  }

  async invite(
    actor: ActorContext,
    projectId: string,
    input: CreateProjectInvite,
    now = new Date(),
  ): Promise<ProjectInviteView> {
    const access = await this.evaluate(actor, projectId, now);
    this.assertMutable(access);
    if (!access.capabilities.canInvite) {
      throw new ProjectError("FORBIDDEN", "Not allowed to invite members");
    }
    const email = normalizeInviteEmail(input.email);
    if (email === normalizeInviteEmail(actor.email) && access.actorMember.role === "OWNER") {
      throw new ProjectError("CONFLICT", "The owner is already a member");
    }
    const existingMember = access.project.members.find(
      (member) => normalizeInviteEmail(member.user.email) === email,
    );
    if (existingMember) {
      throw new ProjectError("CONFLICT", "User is already a project member");
    }
    const activeMembers = activeMemberUserIds(
      access.project.members.map(toRankableMember),
      access.ownerLimits.membersPerOwnedProjectMax,
    );
    if (!isWithinCountLimit(access.ownerLimits.membersPerOwnedProjectMax, activeMembers.size)) {
      throw new ProjectError("MEMBER_LIMIT", "Active member limit reached for the owner plan");
    }

    const pending = await this.db.projectInvite.findFirst({
      where: {
        projectId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (pending) {
      throw new ProjectError("CONFLICT", "An invite is already pending for this email");
    }

    const token = generateInviteToken();
    const expiresAt = new Date(now.getTime() + this.options.inviteTtlDays * 24 * 60 * 60 * 1000);
    const created = await this.db.projectInvite.create({
      data: {
        projectId,
        email,
        role: input.role,
        tokenHash: hashInviteToken(token, this.options.tokenSecret),
        createdByUserId: actor.userId,
        expiresAt,
      },
    });
    return {
      id: created.id,
      email: created.email,
      role: created.role as ProjectInviteView["role"],
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
      inviteUrl: inviteUrl(this.options.webOrigin, token),
    };
  }

  async listInvites(actor: ActorContext, projectId: string, now = new Date()): Promise<ProjectInviteView[]> {
    const access = await this.evaluate(actor, projectId, now);
    if (!access.capabilities.canManageMembers && !access.capabilities.canInvite) {
      throw new ProjectError("FORBIDDEN", "Not allowed to list invites");
    }
    const rows = await this.db.projectInvite.findMany({
      where: { projectId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as ProjectInviteView["role"],
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      inviteUrl: null,
    }));
  }

  async revokeInvite(actor: ActorContext, projectId: string, inviteId: string, now = new Date()): Promise<void> {
    const access = await this.evaluate(actor, projectId, now);
    this.assertMutable(access);
    if (!access.capabilities.canManageMembers) {
      throw new ProjectError("FORBIDDEN", "Not allowed to revoke invites");
    }
    const invite = await this.db.projectInvite.findFirst({
      where: { id: inviteId, projectId, acceptedAt: null, revokedAt: null },
    });
    if (!invite) {
      throw new ProjectError("NOT_FOUND", "Invite not found");
    }
    await this.db.projectInvite.update({
      where: { id: invite.id },
      data: { revokedAt: now },
    });
  }

  async acceptInvite(actor: ActorContext, token: string, now = new Date()): Promise<ProjectView> {
    const tokenHash = hashInviteToken(token, this.options.tokenSecret);
    const invite = await this.db.projectInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= now) {
      throw new ProjectError("INVITE_INVALID", "Invite is invalid or expired");
    }
    if (normalizeInviteEmail(actor.email) !== invite.email) {
      throw new ProjectError("INVITE_EMAIL_MISMATCH", "Invite belongs to a different email");
    }

    const project = await this.db.project.findUnique({
      where: { id: invite.projectId },
      include: memberInclude,
    });
    if (!project) {
      throw new ProjectError("INVITE_INVALID", "Invite is invalid or expired");
    }
    const already = project.members.find((member) => member.userId === actor.userId);
    if (already) {
      throw new ProjectError("CONFLICT", "User is already a project member");
    }

    const ownerPlan = await this.plans.resolve(project.ownerUserId, now);
    const ownerLimits = projectEntitlementLimits(ownerPlan.entitlements, ownerPlan.source);
    const ownedLocked = await this.lockedOwnedIds(project.ownerUserId, ownerLimits.ownedActiveMax);
    const projectLocked = ownedLocked.has(project.id);
    if (!projectLocked) {
      const activeMembers = activeMemberUserIds(
        project.members.map(toRankableMember),
        ownerLimits.membersPerOwnedProjectMax,
      );
      if (!isWithinCountLimit(ownerLimits.membersPerOwnedProjectMax, activeMembers.size)) {
        throw new ProjectError("MEMBER_LIMIT", "Active member limit reached for the owner plan");
      }
    }

    await this.db.$transaction(async (tx) => {
      await lockQuota(tx, "project-members", invite.projectId);
      const fresh = await tx.projectInvite.findUnique({ where: { id: invite.id } });
      if (!fresh || fresh.revokedAt || fresh.acceptedAt || fresh.expiresAt <= now) {
        throw new ProjectError("INVITE_INVALID", "Invite is invalid or expired");
      }
      const freshProject = await tx.project.findUnique({
        where: { id: fresh.projectId },
        include: memberInclude,
      });
      if (!freshProject) {
        throw new ProjectError("INVITE_INVALID", "Invite is invalid or expired");
      }
      const freshPlan = await new EffectivePlanResolver(tx).resolve(freshProject.ownerUserId, now);
      const freshLimits = projectEntitlementLimits(freshPlan.entitlements, freshPlan.source);
      const lockedIds = lockedOwnedProjectIds(
        (await tx.project.findMany({
          where: { ownerUserId: freshProject.ownerUserId },
          select: { id: true, createdAt: true, members: { where: { userId: freshProject.ownerUserId }, select: { lastOpenedAt: true } } },
        })).map((item) => ({ id: item.id, createdAt: item.createdAt, lastOpenedAt: item.members[0]?.lastOpenedAt ?? null })),
        freshLimits.ownedActiveMax,
      );
      if (!lockedIds.has(freshProject.id)) {
        const activeMembers = activeMemberUserIds(
          freshProject.members.map(toRankableMember),
          freshLimits.membersPerOwnedProjectMax,
        );
        if (!isWithinCountLimit(freshLimits.membersPerOwnedProjectMax, activeMembers.size)) {
          throw new ProjectError("MEMBER_LIMIT", "Active member limit reached for the owner plan");
        }
      }
      await tx.projectInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: now },
      });
      await tx.projectMember.create({
        data: {
          projectId: invite.projectId,
          userId: actor.userId,
          role: invite.role,
        },
      });
    });
    return this.toView(await this.evaluate(actor, invite.projectId, now));
  }

  async updateMemberRole(
    actor: ActorContext,
    projectId: string,
    targetUserId: string,
    role: Exclude<ProjectMemberRole, "OWNER">,
    now = new Date(),
  ): Promise<ProjectMemberView[]> {
    const access = await this.evaluate(actor, projectId, now);
    this.assertMutable(access);
    if (!access.capabilities.canManageMembers) {
      throw new ProjectError("FORBIDDEN", "Not allowed to change member roles");
    }
    const target = access.project.members.find((member) => member.userId === targetUserId);
    if (!target) {
      throw new ProjectError("NOT_FOUND", "Member not found");
    }
    if (target.role === "OWNER") {
      throw new ProjectError("ROLE_FORBIDDEN", "Ownership cannot be transferred");
    }
    await this.db.projectMember.update({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      data: { role },
    });
    return this.listMembers(actor, projectId, now);
  }

  async removeMember(actor: ActorContext, projectId: string, targetUserId: string, now = new Date()): Promise<void> {
    const access = await this.evaluate(actor, projectId, now);
    this.assertMutable(access);
    if (!access.capabilities.canManageMembers) {
      throw new ProjectError("FORBIDDEN", "Not allowed to remove members");
    }
    const target = access.project.members.find((member) => member.userId === targetUserId);
    if (!target) {
      throw new ProjectError("NOT_FOUND", "Member not found");
    }
    if (target.role === "OWNER") {
      throw new ProjectError("ROLE_FORBIDDEN", "The owner cannot be removed");
    }
    await this.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
  }

  async leave(actor: ActorContext, projectId: string, now = new Date()): Promise<void> {
    const access = await this.evaluate(actor, projectId, now);
    if (!access.capabilities.canLeave) {
      throw new ProjectError("ROLE_FORBIDDEN", "The owner cannot leave the project");
    }
    await this.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: actor.userId } },
    });
  }

  private assertMutable(access: AccessSnapshot): void {
    if (access.projectState === "PLAN_LOCKED") {
      throw new ProjectError("PLAN_LOCKED", "Project is locked by the owner plan");
    }
    if (isEntitlementReadOnly(access.viewerState)) {
      throw new ProjectError("ENTITLEMENT_DENIED", "Project access is read-only on the current plan");
    }
  }

  private async evaluate(actor: ActorContext, projectId: string, now: Date): Promise<AccessSnapshot> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      include: memberInclude,
    });
    if (!project) {
      throw new ProjectError("NOT_FOUND", "Project not found");
    }
    return this.evaluateLoaded(actor, project, now);
  }

  private async evaluateLoaded(actor: ActorContext, project: ProjectRow, now: Date): Promise<AccessSnapshot> {
    const snapshots = await this.evaluateMany(actor, [project], now);
    const match = snapshots[0];
    if (!match) {
      throw new ProjectError("NOT_FOUND", "Project not found");
    }
    return match;
  }

  private async evaluateMany(actor: ActorContext, projects: ProjectRow[], now: Date): Promise<AccessSnapshot[]> {
    if (projects.length === 0) {
      return [];
    }
    const actorMemberByProject = new Map<string, MemberRow>();
    for (const project of projects) {
      const member = project.members.find((item) => item.userId === actor.userId);
      if (member) {
        actorMemberByProject.set(project.id, member);
      }
    }
    const visible = projects.filter((project) => actorMemberByProject.has(project.id));
    if (visible.length === 0) {
      throw new ProjectError("NOT_FOUND", "Project not found");
    }

    const ownerIds = [...new Set(visible.map((project) => project.ownerUserId))];
    const [actorPlan, ...ownerPlans] = await Promise.all([
      this.plans.resolve(actor.userId, now),
      ...ownerIds.map((ownerId) => this.plans.resolve(ownerId, now)),
    ]);
    const ownerPlanById = new Map<string, EffectivePlan>();
    for (const [index, ownerId] of ownerIds.entries()) {
      const ownerPlan = ownerPlans[index];
      if (!ownerPlan) {
        throw new ProjectError("NOT_FOUND", "Project not found");
      }
      ownerPlanById.set(ownerId, ownerPlan);
    }
    const actorLimits = projectEntitlementLimits(actorPlan.entitlements, actorPlan.source);

    const ownedLockedByOwner = new Map<string, Set<string>>();
    for (const ownerId of ownerIds) {
      const ownerPlan = ownerPlanById.get(ownerId);
      if (!ownerPlan) {
        throw new ProjectError("NOT_FOUND", "Project not found");
      }
      const limits = projectEntitlementLimits(ownerPlan.entitlements, ownerPlan.source);
      ownedLockedByOwner.set(ownerId, await this.lockedOwnedIds(ownerId, limits.ownedActiveMax));
    }

    const externalMemberships = await this.db.projectMember.findMany({
      where: {
        userId: actor.userId,
        project: { ownerUserId: { not: actor.userId } },
      },
      include: { project: true },
    });
    const externalLocked = lockedExternalProjectIds(
      externalMemberships.map((row) => ({
        id: row.projectId,
        lastOpenedAt: row.lastOpenedAt,
        createdAt: row.createdAt,
      })),
      actorLimits.externalActiveMax,
    );

    return visible.map((project) => {
      const actorMember = actorMemberByProject.get(project.id);
      const ownerPlan = ownerPlanById.get(project.ownerUserId);
      if (!actorMember || !ownerPlan) {
        throw new ProjectError("NOT_FOUND", "Project not found");
      }
      const ownerLimits = projectEntitlementLimits(ownerPlan.entitlements, ownerPlan.source);
      const projectLocked = ownedLockedByOwner.get(project.ownerUserId)?.has(project.id) === true;
      const activeMembers = activeMemberUserIds(project.members.map(toRankableMember), ownerLimits.membersPerOwnedProjectMax);
      const memberLockedByOwnerPlan =
        actorMember.role !== "OWNER" && !projectLocked && !activeMembers.has(actor.userId);
      const memberLockedByMemberPlan = actorMember.role !== "OWNER" && externalLocked.has(project.id);
      const viewerState = viewerAccessState({
        isOwner: actorMember.role === "OWNER",
        projectLocked,
        memberLockedByOwnerPlan,
        memberLockedByMemberPlan,
      });
      const role = actorMember.role as ProjectMemberRole;
      const entitlementReadOnly = isEntitlementReadOnly(viewerState);
      return {
        project,
        actorMember,
        viewerState,
        projectState: projectLocked ? "PLAN_LOCKED" : "ACTIVE",
        lockReason: lockReasonFor(viewerState),
        ownerLimits,
        capabilities: {
          canOpen: true,
          canEdit: !entitlementReadOnly && canEditWithRole(role),
          canInvite: !entitlementReadOnly && canManageMembersWithRole(role),
          canManageMembers: !entitlementReadOnly && canManageMembersWithRole(role),
          canLeave: role !== "OWNER",
          canDelete: role === "OWNER",
        },
      };
    });
  }

  private async lockedOwnedIds(ownerUserId: string, ownedActiveMax: CountLimit): Promise<Set<string>> {
    const owned = await this.db.project.findMany({
      where: { ownerUserId },
      include: {
        members: {
          where: { userId: ownerUserId, role: "OWNER" },
          select: { lastOpenedAt: true, createdAt: true },
        },
      },
    });
    const rankable: RankableProject[] = owned.map((row) => ({
      id: row.id,
      lastOpenedAt: row.members[0]?.lastOpenedAt ?? null,
      createdAt: row.createdAt,
    }));
    return lockedOwnedProjectIds(rankable, ownedActiveMax);
  }

  private toSummary(access: AccessSnapshot): ProjectSummary {
    return {
      id: access.project.id,
      name: access.project.name,
      description: access.project.description,
      ownerUserId: access.project.ownerUserId,
      viewerRole: access.actorMember.role as ProjectMemberRole,
      projectState: access.projectState,
      viewerState: access.viewerState,
      lockReason: access.lockReason,
      readOnly: isEntitlementReadOnly(access.viewerState),
      memberCount: access.project.members.length,
      createdAt: access.project.createdAt.toISOString(),
      updatedAt: access.project.updatedAt.toISOString(),
    };
  }

  private toView(access: AccessSnapshot): ProjectView {
    return {
      ...this.toSummary(access),
      capabilities: access.capabilities,
    };
  }
}

async function lockQuota(tx: Prisma.TransactionClient, namespace: string, id: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${namespace}:${id}`}, 0))`;
}

const memberInclude = {
  members: {
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  },
} satisfies Prisma.ProjectInclude;

function toRankableMember(member: MemberRow) {
  return {
    userId: member.userId,
    role: member.role as ProjectMemberRole,
    lastOpenedAt: member.lastOpenedAt,
    createdAt: member.createdAt,
  };
}

function lockReasonFor(state: ProjectAccessState): ProjectLockReason {
  if (state === "PLAN_LOCKED") {
    return "OWNER_PLAN";
  }
  if (state === "READ_ONLY_BY_MEMBER_PLAN") {
    return "MEMBER_PLAN";
  }
  if (state === "READ_ONLY_BY_OWNER_PLAN") {
    return "OWNER_MEMBER_CAP";
  }
  return null;
}

function memberAccessState(
  access: AccessSnapshot,
  userId: string,
  role: ProjectMemberRole,
  activeMembers: Set<string>,
): ProjectAccessState {
  if (access.projectState === "PLAN_LOCKED") {
    return "PLAN_LOCKED";
  }
  if (role !== "OWNER" && !activeMembers.has(userId)) {
    return "READ_ONLY_BY_OWNER_PLAN";
  }
  if (userId === access.actorMember.userId) {
    return access.viewerState;
  }
  return "ACTIVE";
}

function toMemberView(member: MemberRow, accessState: ProjectAccessState): ProjectMemberView {
  return {
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
    role: member.role as ProjectMemberRole,
    accessState,
    lastOpenedAt: member.lastOpenedAt ? member.lastOpenedAt.toISOString() : null,
    createdAt: member.createdAt.toISOString(),
  };
}

function encodeCursor(project: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: project.createdAt.toISOString(), id: project.id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(raw: string | undefined): { t: string; id: string } | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "t" in parsed &&
      "id" in parsed &&
      typeof parsed.t === "string" &&
      typeof parsed.id === "string"
    ) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    throw new ProjectError("VALIDATION_ERROR", "Invalid cursor");
  }
  throw new ProjectError("VALIDATION_ERROR", "Invalid cursor");
}

function isAfterCursor(project: { createdAt: Date; id: string }, cursor: { t: string; id: string }): boolean {
  const created = project.createdAt.toISOString();
  if (created < cursor.t) {
    return true;
  }
  if (created > cursor.t) {
    return false;
  }
  return project.id < cursor.id;
}
