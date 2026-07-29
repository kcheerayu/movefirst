"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSimpleClient, updateClient } from "@/lib/admin/clients";

const optional = (value: FormDataEntryValue | null) => { const text = String(value ?? "").trim(); return text === "-" ? "" : text; };
const values = (formData: FormData) => ({
  slug: optional(formData.get("slug")), name: String(formData.get("name") ?? ""), website: optional(formData.get("website")),
  industry: optional(formData.get("industry")), description: optional(formData.get("description")),
  primaryContact: optional(formData.get("primaryContact")), contactEmail: optional(formData.get("contactEmail")), contactPhone: optional(formData.get("contactPhone")),
  userIds: formData.getAll("userIds").map(String), agentIds: formData.getAll("agentIds").map(String),
});
export async function createClientAction(formData: FormData) {
  const created = await createSimpleClient({ name: String(formData.get("name") ?? ""), contactName: String(formData.get("contactName") ?? ""), industry: String(formData.get("industry") ?? "") });
  revalidatePath("/clients");
  redirect(`/clients/${encodeURIComponent(created.slug)}`);
}
export async function updateClientAction(formData: FormData) {
  const input = values(formData);
  await updateClient({ ...input, id: String(formData.get("id") ?? ""), status: String(formData.get("status") ?? "active") as "active" | "inactive" | "archived" });
  revalidatePath("/clients");
  revalidatePath(`/clients/${encodeURIComponent(input.slug.trim().toLowerCase())}`);
}
