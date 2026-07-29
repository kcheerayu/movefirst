import "server-only";

import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.").max(120);
const base = z.object({
  slug,
  name: z.string().trim().min(2).max(160),
  website: z.string().trim().url().max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  primaryContact: z.string().trim().max(160).optional().or(z.literal("")),
  contactEmail: z.string().trim().email().max(255).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(60).optional().or(z.literal("")),
  userIds: z.array(z.string().uuid()).default([]),
  agentIds: z.array(z.string().uuid()).default([]),
});
const createSchema = base;
const updateSchema = base.extend({ id: z.string().uuid(), status: z.enum(["active", "inactive", "archived"]) });

const simpleCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(160),
  industry: z.string().trim().min(1).max(120),
});

export function clientSlugFromName(name: string) {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 110);
  return slug || "client";
}

export async function createSimpleClient(input: unknown) {
  const actor = await requirePermission("clients.manage");
  const value = simpleCreateSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("app_create_client_simple", {
    target_slug: clientSlugFromName(value.name),
    target_name: value.name,
    target_contact_name: value.contactName,
    target_industry: value.industry,
    actor_user_id: actor.user.id,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.id || !row.slug) throw new Error(error?.message || "Unable to create client.");
  return row as { id: string; slug: string };
}

export async function createClient(input: z.input<typeof createSchema>) {
  const actor = await requirePermission("clients.manage");
  const value = createSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("app_create_client", {
    target_slug: value.slug,
    target_name: value.name,
    target_website: value.website || "",
    target_industry: value.industry || "",
    target_description: value.description || "",
    target_primary_contact: value.primaryContact || "",
    target_contact_email: value.contactEmail || "",
    target_contact_phone: value.contactPhone || "",
    target_user_ids: value.userIds,
    target_agent_ids: value.agentIds,
    actor_user_id: actor.user.id,
  });
  if (error || !data) throw new Error(error?.message || "Unable to create client.");
  return data as string;
}

export async function updateClient(input: z.input<typeof updateSchema>) {
  const actor = await requirePermission("clients.manage");
  const value = updateSchema.parse(input);
  const admin = createAdminClient();
  const { error } = await admin.rpc("app_update_client", {
    target_client_id: value.id,
    target_slug: value.slug,
    target_name: value.name,
    target_website: value.website || "",
    target_industry: value.industry || "",
    target_description: value.description || "",
    target_primary_contact: value.primaryContact || "",
    target_contact_email: value.contactEmail || "",
    target_contact_phone: value.contactPhone || "",
    target_status: value.status,
    target_user_ids: value.userIds,
    target_agent_ids: value.agentIds,
    actor_user_id: actor.user.id,
  });
  if (error) throw new Error(error.message || "Unable to update client.");
}
