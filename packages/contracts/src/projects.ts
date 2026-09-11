import { z } from "zod";

export const PROJECT_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  descriptionMax: 2_000,
  pageLimitDefault: 50,
  pageLimitMax: 100,
  inviteTtlDays: 7,
} as const;

export const projectMemberRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

export const projectInviteRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

export const projectAccessStateSchema = z.enum([
  "ACTIVE",
  "PLAN_LOCKED",
  "READ_ONLY_BY_OWNER_PLAN",
  "READ_ONLY_BY_MEMBER_PLAN",
]);
export type ProjectAccessState = z.infer<typeof projectAccessStateSchema>;

export const projectLockReasonSchema = z.enum(["OWNER_PLAN", "MEMBER_PLAN", "OWNER_MEMBER_CAP"]).nullable();
export type ProjectLockReason = z.infer<typeof projectLockReasonSchema>;

export const projectCapabilitiesSchema = z.object({
  canOpen: z.boolean(),
  canEdit: z.boolean(),
  canInvite: z.boolean(),
  canManageMembers: z.boolean(),
  canLeave: z.boolean(),
  canDelete: z.boolean(),
});
export type ProjectCapabilities = z.infer<typeof projectCapabilitiesSchema>;

const isoDateTime = z.string().datetime({ offset: true });

export const projectMemberViewSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
  role: projectMemberRoleSchema,
  accessState: projectAccessStateSchema,
  lastOpenedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type ProjectMemberView = z.infer<typeof projectMemberViewSchema>;

export const projectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  ownerUserId: z.string().min(1),
  viewerRole: projectMemberRoleSchema,
  projectState: z.enum(["ACTIVE", "PLAN_LOCKED"]),
  viewerState: projectAccessStateSchema,
  lockReason: projectLockReasonSchema,
  readOnly: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectViewSchema = projectSummarySchema.extend({
  capabilities: projectCapabilitiesSchema,
});
export type ProjectView = z.infer<typeof projectViewSchema>;

export const projectsResponseSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;

export const projectMembersResponseSchema = z.object({
  items: z.array(projectMemberViewSchema),
});
export type ProjectMembersResponse = z.infer<typeof projectMembersResponseSchema>;

export const projectInviteViewSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: projectInviteRoleSchema,
  expiresAt: isoDateTime,
  createdAt: isoDateTime,
  inviteUrl: z.string().url().nullable(),
});
export type ProjectInviteView = z.infer<typeof projectInviteViewSchema>;

export const projectInvitesResponseSchema = z.object({
  items: z.array(projectInviteViewSchema),
});
export type ProjectInvitesResponse = z.infer<typeof projectInvitesResponseSchema>;

const forbiddenProjectAuthorityFields = {
  userId: true,
  ownerId: true,
  ownerUserId: true,
  role: true,
  lastOpenedAt: true,
  lastVisitedAt: true,
  accessState: true,
  projectState: true,
  planCode: true,
} as const;

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(PROJECT_LIMITS.nameMin).max(PROJECT_LIMITS.nameMax),
    description: z.string().trim().max(PROJECT_LIMITS.descriptionMax).nullable().optional(),
  })
  .strict()
  .refine((value) => !("userId" in value), { message: "forbidden_field" });
export type CreateProject = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(PROJECT_LIMITS.nameMin).max(PROJECT_LIMITS.nameMax).optional(),
    description: z.string().trim().max(PROJECT_LIMITS.descriptionMax).nullable().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "empty_patch",
  });
export type UpdateProject = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PROJECT_LIMITS.pageLimitMax)
    .default(PROJECT_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
});

export const createProjectInviteSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: projectInviteRoleSchema.default("MEMBER"),
  })
  .strict();
export type CreateProjectInvite = z.infer<typeof createProjectInviteSchema>;

export const acceptProjectInviteSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
  })
  .strict();
export type AcceptProjectInvite = z.infer<typeof acceptProjectInviteSchema>;

export const projectRoleUpdateSchema = z
  .object({
    role: projectInviteRoleSchema,
  })
  .strict();
export type ProjectRoleUpdate = z.infer<typeof projectRoleUpdateSchema>;

void forbiddenProjectAuthorityFields;
