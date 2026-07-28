import "server-only";

import type { AppContext } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityRow = { id: number; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string; actor_id: string | null; actor: { full_name: string } | null };
export type ActivityFilters = { actor?: string; action?: string; entityType?: string; from?: string; to?: string };

function inScope(row: ActivityRow, context: AppContext) {
  if (context.permissions.includes("platform.manage")) return true;
  if (row.actor_id === context.user.id) return true;
  const clientId = typeof row.metadata.client_id === "string" ? row.metadata.client_id : null;
  const agentId = typeof row.metadata.agent_id === "string" ? row.metadata.agent_id : null;
  return Boolean((clientId && context.clientIds.includes(clientId)) || (agentId && context.agentIds.includes(agentId)));
}

export async function getActivity(context: AppContext, filters: ActivityFilters = {}, limit = 100) {
  const admin = createAdminClient();
  let query = admin.from("activity_logs").select("id,action,entity_type,entity_id,metadata,created_at,actor_id,actor:profiles!activity_logs_actor_id_fkey(full_name)").order("created_at", { ascending: false }).limit(limit);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
  const { data, error } = await query;
  if (error) throw new Error("Unable to load activity.");
  return (data as unknown as ActivityRow[]).filter(row => inScope(row, context)).filter(row => !filters.actor || row.actor_id === filters.actor);
}

export function metadataSummary(metadata: Record<string, unknown>) {
  const safe = Object.entries(metadata).filter(([key]) => !/(password|token|secret|key|credential)/i.test(key)).slice(0, 3);
  return safe.map(([key, value]) => `${key.replace(/_/g, " ")}: ${typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "[details]"}`).join(" · ") || "—";
}
