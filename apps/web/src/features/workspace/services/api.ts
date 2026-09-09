import {
  apiErrorResponseSchema,
  listViewSchema,
  listsResponseSchema,
  noteViewSchema,
  notesResponseSchema,
  reminderViewSchema,
  remindersResponseSchema,
  taskViewSchema,
  tasksResponseSchema,
  workspaceTodayResponseSchema,
  type CreateList,
  type CreateListItem,
  type CreateNote,
  type CreateReminder,
  type CreateTask,
  type ListView,
  type ListsResponse,
  type NoteView,
  type NotesResponse,
  type ReminderView,
  type RemindersResponse,
  type ReorderListItems,
  type TaskStatus,
  type TaskView,
  type TasksResponse,
  type UpdateList,
  type UpdateListItem,
  type UpdateNote,
  type UpdateReminder,
  type UpdateTask,
  type WorkspaceTodayResponse,
} from "@vimla/contracts";
import { publicWebConfig } from "../../../shared/config/public-env";
import { AuthRequiredError } from "../../auth/services/current-user";

export class WorkspaceApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WorkspaceApiError";
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
    throw new WorkspaceApiError(parsed.success ? parsed.data.error.code : "internal_error");
  }
  return parse(payload);
}

export async function fetchToday(fetchImpl: typeof fetch = fetch): Promise<WorkspaceTodayResponse> {
  return request("/v1/workspace/today", {}, (payload) => workspaceTodayResponseSchema.parse(payload), fetchImpl);
}

export async function fetchTasks(
  options: { status?: TaskStatus; fetchImpl?: typeof fetch } = {},
): Promise<TasksResponse> {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return request(
    `/v1/workspace/tasks${suffix}`,
    {},
    (payload) => tasksResponseSchema.parse(payload),
    options.fetchImpl ?? fetch,
  );
}

export async function createTask(input: CreateTask, fetchImpl: typeof fetch = fetch): Promise<TaskView> {
  return request(
    "/v1/workspace/tasks",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => taskViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateTask(id: string, input: UpdateTask, fetchImpl: typeof fetch = fetch): Promise<TaskView> {
  return request(
    `/v1/workspace/tasks/${id}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => taskViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteTask(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return request(`/v1/workspace/tasks/${id}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function fetchReminders(fetchImpl: typeof fetch = fetch): Promise<RemindersResponse> {
  return request("/v1/workspace/reminders", {}, (payload) => remindersResponseSchema.parse(payload), fetchImpl);
}

export async function createReminder(input: CreateReminder, fetchImpl: typeof fetch = fetch): Promise<ReminderView> {
  return request(
    "/v1/workspace/reminders",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => reminderViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateReminder(
  id: string,
  input: UpdateReminder,
  fetchImpl: typeof fetch = fetch,
): Promise<ReminderView> {
  return request(
    `/v1/workspace/reminders/${id}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => reminderViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteReminder(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return request(`/v1/workspace/reminders/${id}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function fetchLists(fetchImpl: typeof fetch = fetch): Promise<ListsResponse> {
  return request("/v1/workspace/lists", {}, (payload) => listsResponseSchema.parse(payload), fetchImpl);
}

export async function fetchList(id: string, fetchImpl: typeof fetch = fetch): Promise<ListView> {
  return request(`/v1/workspace/lists/${id}`, {}, (payload) => listViewSchema.parse(payload), fetchImpl);
}

export async function createList(input: CreateList, fetchImpl: typeof fetch = fetch): Promise<ListView> {
  return request(
    "/v1/workspace/lists",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateList(id: string, input: UpdateList, fetchImpl: typeof fetch = fetch): Promise<ListView> {
  return request(
    `/v1/workspace/lists/${id}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteList(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return request(`/v1/workspace/lists/${id}`, { method: "DELETE" }, () => undefined, fetchImpl);
}

export async function addListItem(
  listId: string,
  input: CreateListItem,
  fetchImpl: typeof fetch = fetch,
): Promise<ListView> {
  return request(
    `/v1/workspace/lists/${listId}/items`,
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateListItem(
  listId: string,
  itemId: string,
  input: UpdateListItem,
  fetchImpl: typeof fetch = fetch,
): Promise<ListView> {
  return request(
    `/v1/workspace/lists/${listId}/items/${itemId}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteListItem(listId: string, itemId: string, fetchImpl: typeof fetch = fetch): Promise<ListView> {
  return request(
    `/v1/workspace/lists/${listId}/items/${itemId}`,
    { method: "DELETE" },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function reorderListItems(
  listId: string,
  input: ReorderListItems,
  fetchImpl: typeof fetch = fetch,
): Promise<ListView> {
  return request(
    `/v1/workspace/lists/${listId}/reorder`,
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => listViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function fetchNotes(
  query: { q?: string; archived?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<NotesResponse> {
  const params = new URLSearchParams();
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.archived) {
    params.set("archived", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/v1/workspace/notes${suffix}`, {}, (payload) => notesResponseSchema.parse(payload), fetchImpl);
}

export async function fetchNote(id: string, fetchImpl: typeof fetch = fetch): Promise<NoteView> {
  return request(`/v1/workspace/notes/${id}`, {}, (payload) => noteViewSchema.parse(payload), fetchImpl);
}

export async function createNote(input: CreateNote, fetchImpl: typeof fetch = fetch): Promise<NoteView> {
  return request(
    "/v1/workspace/notes",
    { method: "POST", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => noteViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function updateNote(id: string, input: UpdateNote, fetchImpl: typeof fetch = fetch): Promise<NoteView> {
  return request(
    `/v1/workspace/notes/${id}`,
    { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(input) },
    (payload) => noteViewSchema.parse(payload),
    fetchImpl,
  );
}

export async function deleteNote(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  return request(`/v1/workspace/notes/${id}`, { method: "DELETE" }, () => undefined, fetchImpl);
}
