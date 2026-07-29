"use server";

import { revalidatePath } from "next/cache";
import { addClientNote, createProject, createTask, submitTaskDeliverable, updateProject, updateTask } from "@/lib/operations";

const projectValues = (formData: FormData) => ({
  id: String(formData.get("id") ?? "") || undefined, clientId: String(formData.get("clientId") ?? ""), name: String(formData.get("name") ?? ""),
  description: String(formData.get("description") ?? ""), status: String(formData.get("status") ?? "planned"), startDate: String(formData.get("startDate") ?? ""), dueDate: String(formData.get("dueDate") ?? ""), ownerId: String(formData.get("ownerId") ?? ""),
});
const taskValues = (formData: FormData) => ({
  id: String(formData.get("id") ?? "") || undefined, title: String(formData.get("title") ?? ""), description: String(formData.get("description") ?? ""), clientId: String(formData.get("clientId") ?? ""), projectId: String(formData.get("projectId") ?? ""), assigneeId: String(formData.get("assigneeId") ?? ""), priority: String(formData.get("priority") ?? "MEDIUM"), status: String(formData.get("status") ?? "TODO"), dueDate: String(formData.get("dueDate") ?? ""),
});
function refresh(clientId?: string) { revalidatePath("/overview"); revalidatePath("/tasks"); revalidatePath("/projects"); revalidatePath("/clients"); if (clientId) revalidatePath(`/clients/${clientId}`); }

export async function createProjectAction(formData: FormData) { const value = projectValues(formData); await createProject(value); refresh(); }
export async function updateProjectAction(formData: FormData) { const value = projectValues(formData); await updateProject(value); refresh(); }
export async function createTaskAction(formData: FormData) { const value = taskValues(formData); await createTask(value); refresh(); }
export async function updateTaskAction(formData: FormData) { const value = taskValues(formData); await updateTask(value); refresh(); }
export async function addClientNoteAction(formData: FormData) { const clientId = String(formData.get("clientId") ?? ""); await addClientNote(clientId, String(formData.get("body") ?? "")); refresh(); }
export async function submitTaskDeliverableAction(formData: FormData) { const taskId = String(formData.get("taskId") ?? ""); await submitTaskDeliverable(taskId, String(formData.get("externalUrl") ?? ""), String(formData.get("note") ?? "")); refresh(); }
