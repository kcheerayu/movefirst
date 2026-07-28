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
  userIds: z.array(z.string().uuid()).default([]),
  agentIds: z.array(z.string().uuid()).default([]),
});
const createSchema = base;
const updateSchema = base.extend({ id: z.string().uuid(), status: z.enum(["active", "inactive", "archived"]) });

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
    target_status: value.status,
    target_user_ids: value.userIds,
    target_agent_ids: value.agentIds,
    actor_user_id: actor.user.id,
  });
  if (error) throw new Error(error.message || "Unable to update client.");
}
