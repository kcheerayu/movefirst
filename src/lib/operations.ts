import "server-only";

import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { requirePermission } from "@/lib/auth/context";
import type { AppContext } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDueThisWeek, isOverdue, projectProgress, type TaskState } from "@/lib/operations-math";

const nullableUuid = z.string().uuid().optional().or(z.literal(""));
const nullableDate = z.string().date().optional().or(z.literal(""));
const projectStatus = z.enum(["planned", "active", "on_hold", "complete", "archived"]);
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "SUBMITTED", "BLOCKED", "DONE"]);
const taskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

const projectSchema = z.object({
  id: z.string().uuid().optional(), clientId: z.string().uuid(), name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional().or(z.literal("")), status: projectStatus.default("planned"),
  startDate: nullableDate, dueDate: nullableDate, ownerId: nullableUuid,
}).refine((value) => !value.startDate || !value.dueDate || value.dueDate >= value.startDate, { message: "Due date must be after the start date." });

const taskSchema = z.object({
  id: z.string().uuid().optional(), title: z.string().trim().min(2).max(240), description: z.string().trim().max(8000).optional().or(z.literal("")),
  clientId: z.string().uuid(), projectId: nullableUuid, assigneeId: nullableUuid, priority: taskPriority.default("MEDIUM"), status: taskStatus.default("TODO"), dueDate: nullableDate,
});

export type TaskFilters = { mine?: boolean; clientId?: string; assigneeId?: string; status?: string; priority?: string; due?: "overdue" | "week" | "all"; search?: string };
export type TaskRow = { id: string; title: string; description: string | null; client_id: string; project_id: string | null; assignee_id: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; status: TaskState; due_date: string | null; created_at: string; updated_at: string; clients: { name: string; slug: string } | null; projects: { name: string } | null; assignee: { full_name: string } | null };
export type ProjectRow = { id: string; client_id: string; name: string; description: string | null; status: string; start_date: string | null; due_date: string | null; owner_id: string | null; clients: { name: string; slug: string } | null; owner: { full_name: string } | null };

function rpcError(error: { message?: string } | null, fallback: string): never { throw new Error(error?.message || fallback); }
function valueOrNull(value: string | undefined) { return value || null; }

export async function createProject(input: unknown) {
  const actor = await requireOwner(); const value = projectSchema.parse(input); const admin = createAdminClient();
  const { data, error } = await admin.rpc("app_create_project", { target_client_id: value.clientId, target_name: value.name, target_description: value.description || "", target_status: value.status, target_start_date: valueOrNull(value.startDate), target_due_date: valueOrNull(value.dueDate), target_owner_id: valueOrNull(value.ownerId), actor_user_id: actor.user.id });
  if (error || !data) rpcError(error, "Unable to create project."); return data as string;
}

export async function updateProject(input: unknown) {
  const actor = await requireOwner(); const value = projectSchema.parse(input); if (!value.id) throw new Error("Project is required."); const admin = createAdminClient();
  const { error } = await admin.rpc("app_update_project", { target_project_id: value.id, target_name: value.name, target_description: value.description || "", target_status: value.status, target_start_date: valueOrNull(value.startDate), target_due_date: valueOrNull(value.dueDate), target_owner_id: valueOrNull(value.ownerId), actor_user_id: actor.user.id });
  if (error) rpcError(error, "Unable to update project.");
}

export async function createTask(input: unknown) {
  const actor = await requireOwner(); const value = taskSchema.parse(input); const admin = createAdminClient();
  const { data, error } = await admin.rpc("app_create_task", { target_title: value.title, target_description: value.description || "", target_client_id: value.clientId, target_project_id: valueOrNull(value.projectId), target_assignee_id: valueOrNull(value.assigneeId), target_priority: value.priority, target_status: value.status, target_due_date: valueOrNull(value.dueDate), actor_user_id: actor.user.id });
  if (error || !data) rpcError(error, "Unable to create task."); return data as string;
}

export async function updateTask(input: unknown) {
  const actor = await requireOwner(); const value = taskSchema.parse(input); if (!value.id) throw new Error("Task is required."); const admin = createAdminClient();
  const { error } = await admin.rpc("app_update_task", { target_task_id: value.id, target_title: value.title, target_description: value.description || "", target_client_id: value.clientId, target_project_id: valueOrNull(value.projectId), target_assignee_id: valueOrNull(value.assigneeId), target_priority: value.priority, target_status: value.status, target_due_date: valueOrNull(value.dueDate), actor_user_id: actor.user.id });
  if (error) rpcError(error, "Unable to update task.");
}

export async function addClientNote(clientId: string, body: string) {
  const actor = await requireOwner(); const parsedClientId = z.string().uuid().parse(clientId); const parsedBody = z.string().trim().min(1).max(8000).parse(body); const admin = createAdminClient();
  const { error } = await admin.rpc("app_create_client_note", { target_client_id: parsedClientId, target_body: parsedBody, actor_user_id: actor.user.id });
  if (error) rpcError(error, "Unable to add note.");
}

export async function submitTaskDeliverable(taskId: string, externalUrl: string, note: string) {
  const actor = await requirePermission("clients.read");
  const task = z.string().uuid().parse(taskId);
  const urlValue = z.string().trim().url().max(2000).optional().or(z.literal("")).parse(externalUrl);
  const noteValue = z.string().trim().max(8000).parse(note);
  const { error } = await createAdminClient().rpc("app_submit_task_deliverable", { target_task_id: task, target_external_url: urlValue, target_note: noteValue, actor_user_id: actor.user.id });
  if (error) throw new Error(error.message || "Unable to submit deliverable.");
}

function scopeClients<T extends { in: (column: string, values: string[]) => T }>(query: T, context: AppContext) {
  return context.permissions.includes("clients.manage") ? query : query.in("client_id", context.clientIds);
}

export async function getTasks(context: AppContext, filters: TaskFilters = {}) {
  const admin = createAdminClient();
  let query = scopeClients(admin.from("tasks").select("id,title,description,client_id,project_id,assignee_id,priority,status,due_date,created_at,updated_at,clients(name,slug),projects(name),assignee:profiles!tasks_assignee_id_fkey(full_name)").order("due_date", { ascending: true, nullsFirst: false }).limit(300), context);
  if (filters.mine) query = query.eq("assignee_id", context.user.id);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.assigneeId && context.permissions.includes("clients.manage")) query = query.eq("assignee_id", filters.assigneeId);
  if (filters.status && taskStatus.options.includes(filters.status as TaskState)) query = query.eq("status", filters.status);
  if (filters.priority && taskPriority.options.includes(filters.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT")) query = query.eq("priority", filters.priority);
  if (filters.search) query = query.ilike("title", `%${filters.search.replace(/[%_]/g, "")}%`);
  const { data, error } = await query; if (error) throw new Error("Unable to load tasks.");
  let rows = (data ?? []) as unknown as TaskRow[];
  if (filters.due === "overdue") rows = rows.filter((task) => isOverdue(task));
  if (filters.due === "week") rows = rows.filter((task) => isDueThisWeek(task));
  return rows;
}

export async function getProjects(context: AppContext, clientId?: string) {
  const admin = createAdminClient(); let query = scopeClients(admin.from("projects").select("id,client_id,name,description,status,start_date,due_date,owner_id,clients(name,slug),owner:profiles!projects_owner_id_fkey(full_name)").order("due_date", { ascending: true, nullsFirst: false }).limit(200), context);
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query; if (error) throw new Error("Unable to load projects."); return (data ?? []) as unknown as ProjectRow[];
}

export async function getOperationsOverview(context: AppContext) {
  const [tasks, projects] = await Promise.all([getTasks(context), getProjects(context)]);
  const admin = createAdminClient();
  let clientQuery = admin.from("clients").select("id,name,slug,status").eq("status", "active").is("archived_at", null);
  if (!context.permissions.includes("clients.manage")) clientQuery = clientQuery.in("id", context.clientIds);
  const { data: clients, error } = await clientQuery.order("name"); if (error) throw new Error("Unable to load clients.");
  const taskByProject = new Map<string, TaskRow[]>(); for (const task of tasks) if (task.project_id) taskByProject.set(task.project_id, [...(taskByProject.get(task.project_id) ?? []), task]);
  const activeProjects = projects.filter((project) => ["planned", "active", "on_hold"].includes(project.status));
  const openTasks = tasks.filter((task) => task.status !== "DONE");
  const unassigned = openTasks.filter((task) => !task.assignee_id);
  const clientIdsWithWork = new Set([...tasks.filter((task) => task.status !== "DONE").map((task) => task.client_id), ...activeProjects.map((project) => project.client_id)]);
  return { clients: clients ?? [], tasks, projects: projects.map((project) => ({ ...project, progress: projectProgress(taskByProject.get(project.id) ?? []) })), openTasks, overdue: openTasks.filter((task) => isOverdue(task)), dueThisWeek: openTasks.filter((task) => isDueThisWeek(task)), activeProjects, unassigned, clientsWithoutWork: (clients ?? []).filter((client) => !clientIdsWithWork.has(client.id)) };
}
