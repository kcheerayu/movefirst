"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, updateClient } from "@/lib/admin/clients";

const values = (formData: FormData) => ({
  slug: String(formData.get("slug") ?? ""), name: String(formData.get("name") ?? ""), website: String(formData.get("website") ?? ""),
  industry: String(formData.get("industry") ?? ""), description: String(formData.get("description") ?? ""),
  primaryContact: String(formData.get("primaryContact") ?? ""), contactEmail: String(formData.get("contactEmail") ?? ""), contactPhone: String(formData.get("contactPhone") ?? ""),
  userIds: formData.getAll("userIds").map(String), agentIds: formData.getAll("agentIds").map(String),
});
export async function createClientAction(formData: FormData) {
  const input = values(formData);
  await createClient(input);
  revalidatePath("/clients");
  redirect(`/clients/${encodeURIComponent(input.slug.trim().toLowerCase())}`);
}
export async function updateClientAction(formData: FormData) {
  const input = values(formData);
  await updateClient({ ...input, id: String(formData.get("id") ?? ""), status: String(formData.get("status") ?? "active") as "active" | "inactive" | "archived" });
  revalidatePath("/clients");
  revalidatePath(`/clients/${encodeURIComponent(input.slug.trim().toLowerCase())}`);
}
