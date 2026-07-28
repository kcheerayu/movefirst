"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, updateClient } from "@/lib/admin/clients";

const values = (formData: FormData) => ({
  slug: String(formData.get("slug") ?? ""), name: String(formData.get("name") ?? ""), website: String(formData.get("website") ?? ""),
  industry: String(formData.get("industry") ?? ""), description: String(formData.get("description") ?? ""),
  userIds: formData.getAll("userIds").map(String), agentIds: formData.getAll("agentIds").map(String),
});
export async function createClientAction(formData: FormData) {
  await createClient(values(formData));
  revalidatePath("/clients");
  redirect(`/clients/${String(formData.get("slug"))}`);
}
export async function updateClientAction(formData: FormData) {
  await updateClient({ ...values(formData), id: String(formData.get("id") ?? ""), status: String(formData.get("status") ?? "active") as "active" | "inactive" | "archived" });
  revalidatePath("/clients");
  revalidatePath(`/clients/${String(formData.get("slug"))}`);
}
