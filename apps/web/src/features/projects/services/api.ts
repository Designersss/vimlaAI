import {
  apiErrorResponseSchema,
  projectInviteViewSchema,
  projectInvitesResponseSchema,
  projectMembersResponseSchema,
  projectViewSchema,
  projectsResponseSchema,
  type CreateProject,
  type CreateProjectInvite,
  type ProjectInviteView,
  type ProjectInvitesResponse,
  type ProjectMembersResponse,
  type ProjectRoleUpdate,
  type ProjectView,
  type ProjectsResponse,
  type UpdateProject,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export class ProjectsApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProjectsApiError";
  }
}

function jsonHeaders(): HeadersInit {
  return { "content-type": "application/json" };
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${publicWebConfig.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (response.status === 204) {
    return parse(undefined);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ProjectsApiError(parsed.success ? parsed.data.error.code : "internal_error");
  }
  return parse(payload);
}

export async function fetchProjects(fetchImpl: typeof fetch = fetch): Promise<ProjectsResponse> {
  return request("/v1/projects", {}, (payload) => projectsResponseSchema.parse(payload), fetchImpl);
}

export async function fetchProject(id: string, fetchImpl: typeof fetch = fetch): Promise<ProjectView> {
  return request(`/v1/projects/${id}`, {}, (payload) => projectViewSchema.parse(payload), fetchImpl);
}

export async function openProject(id: string, fetchImpl: typeof fetch = fetch): Promise<ProjectView> {
  return request(
    `/v1/projects/${id}/open`,
    { method: "POST", headers: jsonHeaders(), body: "{}" },
    (payload) => projectViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function createProject(input: CreateProject, fetchImpl: typeof fetch = fetch): Promise<ProjectView> {
  return request(
    "/v1/projects",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => projectViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateProject(
  id: string,
  input: UpdateProject,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectView> {
  return request(
    `/v1/projects/${id}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => projectViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteProject(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await request(`/v1/projects/${id}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function leaveProject(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await request(
    `/v1/projects/${id}/leave`,
    { method: "POST", headers: jsonHeaders(), body: "{}" },
    () => undefined,
    fetchImpl,
  );
}

export async function fetchMembers(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectMembersResponse> {
  return request(
    `/v1/projects/${projectId}/members`,
    {},
    (payload) => projectMembersResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchInvites(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectInvitesResponse> {
  return request(
    `/v1/projects/${projectId}/invites`,
    {},
    (payload) => projectInvitesResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function createInvite(
  projectId: string,
  input: CreateProjectInvite,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectInviteView> {
  return request(
    `/v1/projects/${projectId}/invites`,
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => projectInviteViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function revokeInvite(
  projectId: string,
  inviteId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await request(`/v1/projects/${projectId}/invites/${inviteId}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  input: ProjectRoleUpdate,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectMembersResponse> {
  return request(
    `/v1/projects/${projectId}/members/${userId}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => projectMembersResponseSchema.parse(payload),
    fetchImpl,
  );
}

export async function removeMember(
  projectId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await request(`/v1/projects/${projectId}/members/${userId}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function acceptInvite(token: string, fetchImpl: typeof fetch = fetch): Promise<ProjectView> {
  return request(
    "/v1/projects/invites/accept",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ token }) },
    (payload) => projectViewSchema.parse(payload),
    fetchImpl,
  );
}
